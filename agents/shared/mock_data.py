"""In-memory mock data for Phase 2 demo. Replaced by Firestore in Phase 3."""

PATIENT_PROFILE = {
    "user_id": "demo_user",
    "name": "Maria Garcia",
    "age": 72,
    "language": "hi",
    "phone": "+1-555-0199",
    "emergency_contact": [
        {
            "name": "Carlos Garcia",
            "relationship": "Son",
            "phone": "+1-555-0123",
        },
        {
            "name": "Sofia Garcia",
            "relationship": "Daughter",
            "phone": "+1-555-0456",
        },
    ],
    "primary_care": {
        "name": "Dr. Priya Patel",
        "phone": "+1-555-0789",
        "specialty": "General Practitioner",
    },
}

MEDICATIONS = [
    {
        "id": "med_1",
        "name": "Metformin",
        "dosage": "500mg",
        "frequency": "twice daily",
        "times": ["08:00", "20:00"],
        "purpose": "diabetes / blood sugar control",
        "pill_description": {
            "color": "white",
            "shape": "round",
            "imprint": "500",
            "size": "small",
        },
        "food_instructions": "Take with food to reduce stomach upset.",
        "side_effects": [
            "nausea",
            "diarrhea",
            "stomach discomfort",
            "metallic taste",
        ],
        "interactions": {
            "lisinopril": {
                "severity": "moderate",
                "description": (
                    "Lisinopril (ACE inhibitor) can amplify Metformin's "
                    "blood-sugar-lowering effect, increasing hypoglycemia risk."
                ),
            },
            "alcohol": {
                "severity": "major",
                "description": (
                    "Alcohol with Metformin can cause dangerous lactic acidosis. "
                    "Even moderate drinking on an empty stomach is risky."
                ),
            },
        },
        "warnings": "Never drink alcohol while taking Metformin.",
    },
    {
        "id": "med_2",
        "name": "Lisinopril",
        "dosage": "10mg",
        "frequency": "once daily",
        "times": ["08:00"],
        "purpose": "blood pressure control",
        "pill_description": {
            "color": "pink",
            "shape": "round",
            "imprint": "L10",
            "size": "small",
        },
        "food_instructions": "Can be taken with or without food.",
        "side_effects": [
            "dry cough",
            "dizziness",
            "headache",
            "fatigue",
        ],
        "interactions": {
            "metformin": {
                "severity": "moderate",
                "description": (
                    "ACE inhibitors potentiate hypoglycemic effects of Metformin, "
                    "increasing low blood sugar risk in elderly patients."
                ),
            },
            "glimepiride": {
                "severity": "moderate",
                "description": (
                    "ACE inhibitors potentiate hypoglycemic effects of sulfonylureas "
                    "like Glimepiride. Monitor blood sugar closely."
                ),
            },
        },
        "warnings": "May cause dry cough. Report persistent cough to doctor.",
    },
    {
        "id": "med_3",
        "name": "Atorvastatin",
        "dosage": "20mg",
        "frequency": "once daily",
        "times": ["20:00"],
        "purpose": "cholesterol management",
        "pill_description": {
            "color": "white",
            "shape": "oval",
            "imprint": "ATV 20",
            "size": "medium",
        },
        "food_instructions": "Best taken in the evening. Can be with or without food.",
        "side_effects": [
            "muscle pain",
            "joint pain",
            "nausea",
            "elevated liver enzymes",
        ],
        "interactions": {},
        "warnings": (
            "Report unexplained muscle pain or weakness to your doctor immediately "
            "— this could indicate a rare but serious side effect."
        ),
    },
    {
        "id": "med_4",
        "name": "Glimepiride",
        "dosage": "2mg",
        "frequency": "once daily",
        "times": ["08:00"],
        "purpose": "diabetes / blood sugar control",
        "pill_description": {
            "color": "green",
            "shape": "oblong",
            "imprint": "G2",
            "size": "medium",
        },
        "food_instructions": "Take with breakfast. NEVER skip meals while on this medication.",
        "side_effects": [
            "hypoglycemia (low blood sugar)",
            "dizziness",
            "nausea",
            "weight gain",
        ],
        "interactions": {
            "lisinopril": {
                "severity": "moderate",
                "description": (
                    "Lisinopril amplifies Glimepiride's blood-sugar-lowering effect. "
                    "Highest hypoglycemia risk of all four medications when combined."
                ),
            },
        },
        "warnings": (
            "Highest hypoglycemia risk. Always eat when taking this medication. "
            "Symptoms of low sugar: shakiness, sweating, confusion, dizziness."
        ),
    },
]

# Mutable at runtime — tools append to these lists
ADHERENCE_LOG: list[dict] = [
    {"date": "2026-03-01", "medication": "Metformin", "time": "08:00", "taken": True},
    {"date": "2026-03-01", "medication": "Metformin", "time": "20:00", "taken": True},
    {"date": "2026-03-01", "medication": "Lisinopril", "time": "08:00", "taken": True},
    {"date": "2026-03-01", "medication": "Atorvastatin", "time": "20:00", "taken": True},
    {"date": "2026-03-01", "medication": "Glimepiride", "time": "08:00", "taken": True},
    # 2nd — missed evening Metformin
    {"date": "2026-03-02", "medication": "Metformin", "time": "08:00", "taken": True},
    {"date": "2026-03-02", "medication": "Metformin", "time": "20:00", "taken": False},
    {"date": "2026-03-02", "medication": "Lisinopril", "time": "08:00", "taken": True},
    {"date": "2026-03-02", "medication": "Atorvastatin", "time": "20:00", "taken": True},
    {"date": "2026-03-02", "medication": "Glimepiride", "time": "08:00", "taken": True},
    # 3rd — all taken
    {"date": "2026-03-03", "medication": "Metformin", "time": "08:00", "taken": True},
    {"date": "2026-03-03", "medication": "Metformin", "time": "20:00", "taken": True},
    {"date": "2026-03-03", "medication": "Lisinopril", "time": "08:00", "taken": True},
    {"date": "2026-03-03", "medication": "Atorvastatin", "time": "20:00", "taken": True},
    {"date": "2026-03-03", "medication": "Glimepiride", "time": "08:00", "taken": True},
    # 4th — missed Glimepiride
    {"date": "2026-03-04", "medication": "Metformin", "time": "08:00", "taken": True},
    {"date": "2026-03-04", "medication": "Metformin", "time": "20:00", "taken": True},
    {"date": "2026-03-04", "medication": "Lisinopril", "time": "08:00", "taken": True},
    {"date": "2026-03-04", "medication": "Atorvastatin", "time": "20:00", "taken": True},
    {"date": "2026-03-04", "medication": "Glimepiride", "time": "08:00", "taken": False},
    # 5th–7th — all taken
    {"date": "2026-03-05", "medication": "Metformin", "time": "08:00", "taken": True},
    {"date": "2026-03-05", "medication": "Metformin", "time": "20:00", "taken": True},
    {"date": "2026-03-05", "medication": "Lisinopril", "time": "08:00", "taken": True},
    {"date": "2026-03-05", "medication": "Atorvastatin", "time": "20:00", "taken": True},
    {"date": "2026-03-05", "medication": "Glimepiride", "time": "08:00", "taken": True},
    {"date": "2026-03-06", "medication": "Metformin", "time": "08:00", "taken": True},
    {"date": "2026-03-06", "medication": "Metformin", "time": "20:00", "taken": True},
    {"date": "2026-03-06", "medication": "Lisinopril", "time": "08:00", "taken": True},
    {"date": "2026-03-06", "medication": "Atorvastatin", "time": "20:00", "taken": True},
    {"date": "2026-03-06", "medication": "Glimepiride", "time": "08:00", "taken": True},
    {"date": "2026-03-07", "medication": "Metformin", "time": "08:00", "taken": True},
    {"date": "2026-03-07", "medication": "Metformin", "time": "20:00", "taken": True},
    {"date": "2026-03-07", "medication": "Lisinopril", "time": "08:00", "taken": True},
    {"date": "2026-03-07", "medication": "Atorvastatin", "time": "20:00", "taken": True},
    {"date": "2026-03-07", "medication": "Glimepiride", "time": "08:00", "taken": True},
]

VITALS_LOG: list[dict] = [
    {"date": "2026-03-01", "type": "blood_pressure", "value": "138/88", "unit": "mmHg"},
    {"date": "2026-03-01", "type": "blood_sugar", "value": 145, "unit": "mg/dL"},
    {"date": "2026-03-02", "type": "blood_pressure", "value": "135/85", "unit": "mmHg"},
    {"date": "2026-03-02", "type": "blood_sugar", "value": 138, "unit": "mg/dL"},
    {"date": "2026-03-03", "type": "blood_pressure", "value": "130/82", "unit": "mmHg"},
    {"date": "2026-03-03", "type": "blood_sugar", "value": 132, "unit": "mg/dL"},
    {"date": "2026-03-04", "type": "blood_pressure", "value": "132/84", "unit": "mmHg"},
    {"date": "2026-03-04", "type": "blood_sugar", "value": 140, "unit": "mg/dL"},
    {"date": "2026-03-05", "type": "weight", "value": 68.5, "unit": "kg"},
    {"date": "2026-03-05", "type": "blood_pressure", "value": "128/80", "unit": "mmHg"},
    {"date": "2026-03-05", "type": "blood_sugar", "value": 125, "unit": "mg/dL"},
    {"date": "2026-03-06", "type": "blood_pressure", "value": "130/82", "unit": "mmHg"},
    {"date": "2026-03-06", "type": "blood_sugar", "value": 130, "unit": "mg/dL"},
    {"date": "2026-03-07", "type": "blood_pressure", "value": "126/79", "unit": "mmHg"},
    {"date": "2026-03-07", "type": "blood_sugar", "value": 122, "unit": "mg/dL"},
    # --- Wearable vitals (Fitbit) ---
    {"date": "2026-03-07", "type": "heart_rate", "value": 72, "unit": "bpm", "source": "fitbit"},
    {"date": "2026-03-07", "type": "resting_heart_rate", "value": 68, "unit": "bpm", "source": "fitbit"},
    {"date": "2026-03-07", "type": "spo2", "value": 97, "unit": "%", "source": "fitbit"},
    {"date": "2026-03-07", "type": "steps", "value": 6823, "unit": "steps", "source": "fitbit"},
    {"date": "2026-03-07", "type": "sleep_duration", "value": 7.2, "unit": "hours", "source": "fitbit"},
    {"date": "2026-03-07", "type": "active_minutes", "value": 42, "unit": "min", "source": "fitbit"},
    {"date": "2026-03-06", "type": "heart_rate", "value": 74, "unit": "bpm", "source": "fitbit"},
    {"date": "2026-03-06", "type": "steps", "value": 5410, "unit": "steps", "source": "fitbit"},
    {"date": "2026-03-06", "type": "sleep_duration", "value": 6.5, "unit": "hours", "source": "fitbit"},
    {"date": "2026-03-05", "type": "steps", "value": 8102, "unit": "steps", "source": "fitbit"},
    {"date": "2026-03-05", "type": "sleep_duration", "value": 7.8, "unit": "hours", "source": "fitbit"},
    # --- CGM readings (Dexcom G7) — sample across the day ---
    {"date": "2026-03-07", "time": "00:00", "type": "glucose_cgm", "value": 105, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "01:00", "type": "glucose_cgm", "value": 98, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "02:00", "type": "glucose_cgm", "value": 92, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "03:00", "type": "glucose_cgm", "value": 68, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "04:00", "type": "glucose_cgm", "value": 82, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "05:00", "type": "glucose_cgm", "value": 88, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "06:00", "type": "glucose_cgm", "value": 95, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "07:00", "type": "glucose_cgm", "value": 110, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "08:00", "type": "glucose_cgm", "value": 135, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "09:00", "type": "glucose_cgm", "value": 155, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "10:00", "type": "glucose_cgm", "value": 142, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "11:00", "type": "glucose_cgm", "value": 128, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "12:00", "type": "glucose_cgm", "value": 118, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "13:00", "type": "glucose_cgm", "value": 195, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "14:00", "type": "glucose_cgm", "value": 172, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "15:00", "type": "glucose_cgm", "value": 148, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "16:00", "type": "glucose_cgm", "value": 132, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "17:00", "type": "glucose_cgm", "value": 125, "unit": "mg/dL", "source": "dexcom"},
    {"date": "2026-03-07", "time": "18:00", "type": "glucose_cgm", "value": 140, "unit": "mg/dL", "source": "dexcom"},
]

WEARABLE_CONNECTIONS: list[dict] = [
    {"provider": "dexcom", "device": "Dexcom G7", "connected_at": "2026-02-15", "last_sync": "2026-03-07T18:30:00Z", "status": "active"},
    {"provider": "fitbit", "device": "Fitbit Sense 2", "connected_at": "2026-02-20", "last_sync": "2026-03-07T18:00:00Z", "status": "active"},
]

MEALS_LOG: list[dict] = [
    {"date": "2026-03-07", "meal_type": "breakfast", "description": "Oatmeal with berries, green tea"},
    {"date": "2026-03-07", "meal_type": "lunch", "description": "Grilled chicken salad, water"},
]

FAMILY_ALERTS: list[dict] = []

PRESCRIPTIONS: list[dict] = []

REPORTS: list[dict] = []

EMERGENCY_INCIDENTS: list[dict] = []

CALL_LOGS: list[dict] = []

APPOINTMENTS: list[dict] = []

FOOD_LOGS: list[dict] = []
