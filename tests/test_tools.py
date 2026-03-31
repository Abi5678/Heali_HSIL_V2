"""Unit tests for Phase 2 tool functions.

All tools are now async. Tests call without tool_context → mock data fallback.
"""

import pytest

from agents.guardian.tools import (
    get_medication_schedule,
    log_medication_taken,
    verify_pill,
    detect_emergency_severity,
    initiate_emergency_protocol,
    initiate_family_call,
    log_vitals,
    log_meal,
)
from agents.insights.tools import (
    get_adherence_score,
    get_vital_trends,
    get_daily_digest,
    send_family_alert,
)
from agents.interpreter.tools import read_prescription, read_report, translate_text


class TestGuardianTools:
    @pytest.mark.asyncio
    async def test_get_medication_schedule_returns_all_meds(self):
        result = await get_medication_schedule()
        assert "schedule" in result
        assert "date" in result
        # 4 meds: Metformin x2 times, Lisinopril x1, Atorvastatin x1, Glimepiride x1 = 5
        assert len(result["schedule"]) == 5

    @pytest.mark.asyncio
    async def test_verify_pill_matches_metformin(self):
        result = await verify_pill(pill_color="white", pill_shape="round", pill_imprint="500")
        assert result["verified"] is True
        assert any(m["medication"] == "Metformin" for m in result["matches"])
        assert result["matches"][0]["confidence"] == "high"

    @pytest.mark.asyncio
    async def test_verify_pill_matches_without_imprint(self):
        result = await verify_pill(pill_color="pink", pill_shape="round")
        assert result["verified"] is True
        assert result["matches"][0]["medication"] == "Lisinopril"
        assert result["matches"][0]["confidence"] == "medium"

    @pytest.mark.asyncio
    async def test_verify_pill_matches_green_oblong(self):
        result = await verify_pill(pill_color="green", pill_shape="oblong", pill_imprint="G2")
        assert result["verified"] is True
        assert result["matches"][0]["medication"] == "Glimepiride"

    @pytest.mark.asyncio
    async def test_verify_pill_rejects_unknown(self):
        result = await verify_pill(pill_color="blue", pill_shape="hexagonal")
        assert result["verified"] is False
        assert "WARNING" in result["message"]
        assert len(result["known_medications"]) == 4

    @pytest.mark.asyncio
    async def test_log_medication_taken_success(self):
        result = await log_medication_taken(medication_name="Metformin")
        assert result["success"] is True
        assert result["medication"] == "Metformin"
        assert result["dosage"] == "500mg"
        assert "logged_at" in result

    @pytest.mark.asyncio
    async def test_log_medication_taken_case_insensitive(self):
        result = await log_medication_taken(medication_name="metformin")
        assert result["success"] is True

    @pytest.mark.asyncio
    async def test_log_medication_taken_unknown(self):
        result = await log_medication_taken(medication_name="Aspirin")
        assert result["success"] is False
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_log_vitals_blood_pressure(self):
        result = await log_vitals(vital_type="blood_pressure", value="130/85")
        assert result["success"] is True
        assert result["recorded"]["unit"] == "mmHg"

    @pytest.mark.asyncio
    async def test_log_vitals_blood_sugar(self):
        result = await log_vitals(vital_type="blood_sugar", value="125")
        assert result["success"] is True
        assert result["recorded"]["unit"] == "mg/dL"

    @pytest.mark.asyncio
    async def test_log_vitals_custom_unit(self):
        result = await log_vitals(vital_type="temperature", value="98.6", unit="F")
        assert result["success"] is True
        assert result["recorded"]["unit"] == "F"

    @pytest.mark.asyncio
    async def test_log_meal(self):
        result = await log_meal(description="Rice and dal", meal_type="lunch")
        assert result["success"] is True
        assert result["recorded"]["meal_type"] == "lunch"

    @pytest.mark.asyncio
    async def test_log_meal_default_type(self):
        result = await log_meal(description="Apple")
        assert result["success"] is True
        assert result["recorded"]["meal_type"] == "snack"


class TestInsightsTools:
    @pytest.mark.asyncio
    async def test_get_adherence_score(self):
        result = await get_adherence_score(days=30)
        assert "score" in result
        assert 0 <= result["score"] <= 100
        assert result["total_doses"] > 0
        assert result["rating"] in ["excellent", "good", "needs improvement"]

    @pytest.mark.asyncio
    async def test_get_adherence_score_has_missed(self):
        result = await get_adherence_score(days=30)
        # Mock data has 2 missed doses (Feb 22 evening Metformin, Feb 24 Glimepiride)
        assert result["missed"] >= 2
        assert "Metformin" in result["missed_medications"]

    @pytest.mark.asyncio
    async def test_get_vital_trends_blood_sugar(self):
        result = await get_vital_trends(vital_type="blood_sugar", days=30)
        assert result["vital_type"] == "blood_sugar"
        assert result["trend"] in ["improving", "stable", "increasing", "insufficient data"]
        if result["trend"] != "insufficient data":
            assert "change" in result
            assert "first_reading" in result
            assert "latest_reading" in result

    @pytest.mark.asyncio
    async def test_get_vital_trends_blood_pressure(self):
        result = await get_vital_trends(vital_type="blood_pressure", days=30)
        assert result["vital_type"] == "blood_pressure"
        assert result["trend"] in ["improving", "stable", "increasing", "insufficient data"]

    @pytest.mark.asyncio
    async def test_get_vital_trends_insufficient_data(self):
        result = await get_vital_trends(vital_type="weight", days=1)
        # Only one weight reading in mock data
        assert result["trend"] == "insufficient data"

    @pytest.mark.asyncio
    async def test_get_daily_digest(self):
        result = await get_daily_digest()
        assert "date" in result
        assert "medications" in result
        assert "vitals_recorded" in result
        assert "meals_logged" in result
        assert "summary" in result
        assert "taken" in result["medications"]
        assert "pending" in result["medications"]

    @pytest.mark.asyncio
    async def test_send_family_alert(self):
        result = await send_family_alert(
            alert_type="low_adherence",
            message="Patient missed 2 doses this week.",
        )
        assert result["success"] is True
        assert result["alert"]["sent_to"] == "Carlos Garcia"
        assert result["alert"]["alert_type"] == "low_adherence"
        assert "+1-555-0123" in result["alert"]["phone"]


class TestInterpreterTools:
    @pytest.mark.asyncio
    async def test_read_prescription(self):
        result = await read_prescription(
            image_description="Metformin 500mg twice daily with meals"
        )
        assert result["status"] == "extracted"
        assert "Metformin" in result["raw_description"]
        assert result["stored"] is True

    @pytest.mark.asyncio
    async def test_read_report(self):
        result = await read_report(
            image_description="Hemoglobin 14.5 g/dL, Blood Glucose 145 mg/dL"
        )
        assert result["status"] == "extracted"
        assert "Hemoglobin" in result["raw_description"]
        assert result["stored"] is True

    def test_translate_text(self):
        result = translate_text(
            text="Take one pill in the morning",
            source_language="English",
            target_language="Hindi",
        )
        assert result["status"] == "translate"
        assert result["target_language"] == "Hindi"
        assert result["source_language"] == "English"


class TestEmergencyTools:
    @pytest.mark.asyncio
    async def test_detect_red_line_chest_pain(self):
        result = await detect_emergency_severity("I have chest pain")
        assert result["is_red_line"] is True
        assert result["matched_keyword"] == "chest pain"

    @pytest.mark.asyncio
    async def test_detect_red_line_stroke(self):
        result = await detect_emergency_severity("I think I'm having a stroke")
        assert result["is_red_line"] is True
        assert result["matched_keyword"] == "stroke"

    @pytest.mark.asyncio
    async def test_detect_negated_chest_pain(self):
        result = await detect_emergency_severity("I have no chest pain")
        assert result["is_red_line"] is False

    @pytest.mark.asyncio
    async def test_detect_negated_dont_have(self):
        result = await detect_emergency_severity("I don't have chest pain anymore")
        assert result["is_red_line"] is False

    @pytest.mark.asyncio
    async def test_detect_moderate_symptom(self):
        result = await detect_emergency_severity("I feel dizzy and weak")
        assert result["is_red_line"] is False
        assert result["suggested_severity"] == "moderate"

    @pytest.mark.asyncio
    async def test_detect_mild_no_symptoms(self):
        result = await detect_emergency_severity("I feel fine today")
        assert result["is_red_line"] is False
        assert result["suggested_severity"] == "mild"

    @pytest.mark.asyncio
    async def test_emergency_protocol_red_line(self):
        result = await initiate_emergency_protocol(
            symptom_description="chest pain",
            severity="red_line",
        )
        assert result["action"] == "call_emergency"
        assert result["alert_sent"] is True
        assert result["interrupt_audio"] is True
        assert "911" in result["emergency_number"]

    @pytest.mark.asyncio
    async def test_emergency_protocol_moderate(self):
        result = await initiate_emergency_protocol(
            symptom_description="feeling dizzy",
            severity="moderate",
        )
        assert result["action"] == "first_aid_guidance"
        assert result["severity"] == "moderate"


class TestFamilyCallingTools:
    @pytest.mark.asyncio
    async def test_call_by_name(self):
        result = await initiate_family_call(contact_name="Carlos", reason="patient requested")
        assert result["success"] is True
        assert result["contact_name"] == "Carlos Garcia"
        assert "Ringing" in result["message"]

    @pytest.mark.asyncio
    async def test_call_by_relationship(self):
        result = await initiate_family_call(contact_name="son")
        assert result["success"] is True
        assert result["contact_name"] == "Carlos Garcia"

    @pytest.mark.asyncio
    async def test_call_unknown_contact(self):
        result = await initiate_family_call(contact_name="uncle Bob")
        assert result["success"] is False
        assert "couldn't find" in result["message"]

    @pytest.mark.asyncio
    async def test_call_demo_mode(self):
        """Without Twilio env vars, should succeed in demo mode."""
        result = await initiate_family_call(contact_name="Carlos")
        assert result["success"] is True
        assert result.get("demo_mode") is True
        assert "contact_phone_masked" in result
