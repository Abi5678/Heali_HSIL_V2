"""Lightweight async service for drug name normalization and interaction lookups.

Wraps two free public APIs:
- RxNorm (NIH NLM): Normalize drug names to standard identifiers (RxCUI).
- OpenFDA Drug Label: Fetch interaction and side-effect data from drug labels.

Includes a curated fallback knowledge base for the four demo medications to
guarantee reliability during live demos even if external APIs are slow/down.
"""

import asyncio
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Curated Knowledge Base (demo-reliable fallback)
# ---------------------------------------------------------------------------

KNOWN_INTERACTIONS: dict[str, dict[str, Any]] = {
    "lisinopril+metformin": {
        "severity": "moderate",
        "description": (
            "Lisinopril (ACE inhibitor) can amplify Metformin's blood-sugar-lowering "
            "effect, increasing hypoglycemia risk in elderly patients."
        ),
    },
    "glimepiride+metformin": {
        "severity": "moderate",
        "description": (
            "Both lower blood sugar through different mechanisms. Combined use "
            "increases the risk of hypoglycemia. Monitor blood sugar closely."
        ),
    },
    "alcohol+metformin": {
        "severity": "major",
        "description": (
            "Alcohol with Metformin can cause dangerous lactic acidosis, "
            "especially on an empty stomach. Avoid alcohol."
        ),
    },
    "glimepiride+lisinopril": {
        "severity": "moderate",
        "description": (
            "ACE inhibitors potentiate the hypoglycemic effect of sulfonylureas "
            "like Glimepiride. Highest hypoglycemia risk when combined with Metformin."
        ),
    },
    "atorvastatin+metformin": {
        "severity": "none",
        "description": "No clinically significant interaction known.",
    },
    "atorvastatin+lisinopril": {
        "severity": "none",
        "description": "No clinically significant interaction known.",
    },
    "atorvastatin+glimepiride": {
        "severity": "none",
        "description": "No clinically significant interaction known.",
    },
}

KNOWN_DRUG_INFO: dict[str, dict[str, Any]] = {
    "metformin": {
        "generic_name": "Metformin Hydrochloride",
        "drug_class": "Biguanide",
        "purpose": "Type 2 diabetes / blood sugar control",
        "common_side_effects": ["nausea", "diarrhea", "stomach discomfort", "metallic taste"],
        "warnings": "Risk of lactic acidosis with alcohol. Take with food.",
    },
    "lisinopril": {
        "generic_name": "Lisinopril",
        "drug_class": "ACE Inhibitor",
        "purpose": "Hypertension / blood pressure control",
        "common_side_effects": ["dry cough", "dizziness", "headache", "fatigue"],
        "warnings": "May cause persistent dry cough. Potentiates hypoglycemia with diabetes drugs.",
    },
    "atorvastatin": {
        "generic_name": "Atorvastatin Calcium",
        "drug_class": "HMG-CoA Reductase Inhibitor (Statin)",
        "purpose": "Cholesterol management",
        "common_side_effects": ["muscle pain", "joint pain", "nausea"],
        "warnings": "Report unexplained muscle pain immediately — may indicate rhabdomyolysis.",
    },
    "glimepiride": {
        "generic_name": "Glimepiride",
        "drug_class": "Sulfonylurea",
        "purpose": "Type 2 diabetes / blood sugar control",
        "common_side_effects": ["hypoglycemia", "dizziness", "nausea", "weight gain"],
        "warnings": "Highest hypoglycemia risk. Never skip meals while taking this medication.",
    },
}

_RXNORM_BASE = "https://rxnav.nlm.nih.gov/REST"
_OPENFDA_BASE = "https://api.fda.gov/drug/label.json"
_HTTP_TIMEOUT = 8.0


def _normalize_name(name: str) -> str:
    """Lowercase and strip whitespace for consistent key lookups."""
    return name.strip().lower().split()[0] if name else ""


def _interaction_key(drug_a: str, drug_b: str) -> str:
    """Canonical key for a drug pair — alphabetically sorted."""
    a, b = sorted([_normalize_name(drug_a), _normalize_name(drug_b)])
    return f"{a}+{b}"


# ---------------------------------------------------------------------------
# RxNorm API: Drug Name Normalization
# ---------------------------------------------------------------------------


async def normalize_drug_name(drug_name: str) -> dict[str, Any]:
    """Normalize a drug name to its standard RxCUI identifier via RxNorm.

    Falls back to spelling suggestions if exact match fails.
    """
    normalized = _normalize_name(drug_name)
    if normalized in KNOWN_DRUG_INFO:
        return {
            "input": drug_name,
            "normalized_name": KNOWN_DRUG_INFO[normalized]["generic_name"],
            "source": "curated",
        }

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(
                f"{_RXNORM_BASE}/rxcui.json",
                params={"name": drug_name, "search": 1},
            )
            resp.raise_for_status()
            data = resp.json()

            id_group = data.get("idGroup", {})
            rxcui_list = id_group.get("rxnormId", [])
            if rxcui_list:
                return {
                    "input": drug_name,
                    "rxcui": rxcui_list[0],
                    "normalized_name": id_group.get("name", drug_name),
                    "source": "rxnorm",
                }

            spell_resp = await client.get(
                f"{_RXNORM_BASE}/spellingsuggestions.json",
                params={"name": drug_name},
            )
            spell_resp.raise_for_status()
            suggestions = (
                spell_resp.json()
                .get("suggestionGroup", {})
                .get("suggestionList", {})
                .get("suggestion", [])
            )
            if suggestions:
                return {
                    "input": drug_name,
                    "normalized_name": suggestions[0],
                    "suggestions": suggestions[:3],
                    "source": "rxnorm_spelling",
                }
    except Exception as exc:
        logger.warning("RxNorm lookup failed for '%s': %s", drug_name, exc)

    return {
        "input": drug_name,
        "normalized_name": drug_name,
        "source": "passthrough",
    }


# ---------------------------------------------------------------------------
# OpenFDA Drug Label API: Interaction & Side Effect Data
# ---------------------------------------------------------------------------


async def get_drug_info(drug_name: str) -> dict[str, Any]:
    """Fetch drug interaction and side-effect data from OpenFDA labels.

    Falls back to the curated knowledge base for demo medications.
    """
    normalized = _normalize_name(drug_name)
    if normalized in KNOWN_DRUG_INFO:
        return {
            "drug_name": drug_name,
            **KNOWN_DRUG_INFO[normalized],
            "source": "curated",
        }

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(
                _OPENFDA_BASE,
                params={
                    "search": f'openfda.generic_name:"{drug_name}"',
                    "limit": 1,
                },
            )
            resp.raise_for_status()
            results = resp.json().get("results", [])
            if results:
                label = results[0]
                return {
                    "drug_name": drug_name,
                    "generic_name": (label.get("openfda", {}).get("generic_name") or [drug_name])[0],
                    "drug_interactions": label.get("drug_interactions", ["Not available"]),
                    "warnings": label.get("warnings", ["Not available"]),
                    "adverse_reactions": label.get("adverse_reactions", ["Not available"]),
                    "dosage_and_administration": label.get("dosage_and_administration", ["Not available"]),
                    "source": "openfda",
                }
    except Exception as exc:
        logger.warning("OpenFDA lookup failed for '%s': %s", drug_name, exc)

    return {
        "drug_name": drug_name,
        "error": "No data found",
        "source": "none",
    }


# ---------------------------------------------------------------------------
# Pairwise Interaction Check
# ---------------------------------------------------------------------------


async def check_interactions(drug_names: list[str]) -> dict[str, Any]:
    """Check for known interactions between a list of medications.

    Uses the curated fallback first for speed and reliability, then
    supplements with OpenFDA label data for unknown pairs.
    """
    interactions: list[dict[str, Any]] = []
    unknown_pairs: list[tuple[str, str]] = []

    for i, a in enumerate(drug_names):
        for b in drug_names[i + 1:]:
            key = _interaction_key(a, b)
            if key in KNOWN_INTERACTIONS:
                info = KNOWN_INTERACTIONS[key]
                if info["severity"] != "none":
                    interactions.append({
                        "drug_a": a,
                        "drug_b": b,
                        **info,
                        "source": "curated",
                    })
            else:
                unknown_pairs.append((a, b))

    if unknown_pairs:
        label_tasks = []
        unique_drugs = {d for pair in unknown_pairs for d in pair}
        for drug in unique_drugs:
            label_tasks.append(get_drug_info(drug))
        labels_raw = await asyncio.gather(*label_tasks, return_exceptions=True)
        labels = {
            _normalize_name(list(unique_drugs)[i]): r
            for i, r in enumerate(labels_raw)
            if not isinstance(r, Exception)
        }
        for a, b in unknown_pairs:
            a_info = labels.get(_normalize_name(a), {})
            b_info = labels.get(_normalize_name(b), {})
            di_text = " ".join(a_info.get("drug_interactions", []))
            if _normalize_name(b) in di_text.lower():
                interactions.append({
                    "drug_a": a,
                    "drug_b": b,
                    "severity": "unknown",
                    "description": f"Possible interaction found in {a}'s drug label mentioning {b}.",
                    "source": "openfda_label",
                })

    return {
        "medications_checked": drug_names,
        "interactions_found": len(interactions),
        "interactions": interactions,
    }
