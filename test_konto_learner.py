"""
Quick smoke test for KontoLearner.
Run from project root:  python test_konto_learner.py
"""
import sys
sys.path.insert(0, '.')

print("Loading KontenPlanLookup...")
from pipeline.lookup import get_konten_plan_lookup
konten_plan = get_konten_plan_lookup()
print(f"  Loaded {len(konten_plan.accounts)} konto accounts.")

print("\nInitialising KontoLearner (downloads model on first run ~470 MB)...")
from pipeline.konto_learner import KontoLearner
learner = KontoLearner(konten_plan.accounts)
print("  Ready.")

# ------------------------------------------------------------------
# Test 1: Embedding match — phone/internet invoice text
# ------------------------------------------------------------------
print("\n--- Test 1: Embedding match ---")
phone_ocr = """
А1 МАКЕДОНИЈА ДООЕЛ Скопје
Фактура број: INV-2024-001
Датум: 15.03.2024
Телефонски услуги - мобилна телефонија
За наплата: 1.500,00 ден
"""
konto, method, conf = learner.suggest(phone_ocr)
print(f"  Phone invoice  → konto={konto}  method={method}  confidence={conf:.3f}")
assert method in ('embedding_match', 'keyword', 'learned_correction'), f"Unexpected method: {method}"
print("  PASS")

internet_ocr = """
НЕТВОРК ДООЕЛ
Фактура: NET-2024-042
Интернет услуги - широкопојасен интернет
ADSL/Fiber пристап
Вкупно: 850,00 ден
"""
konto, method, conf = learner.suggest(internet_ocr)
print(f"  Internet invoice → konto={konto}  method={method}  confidence={conf:.3f}")
assert method in ('embedding_match', 'keyword', 'learned_correction'), f"Unexpected method: {method}"
print("  PASS")

# ------------------------------------------------------------------
# Test 2: Learn a correction, then verify it's used
# ------------------------------------------------------------------
print("\n--- Test 2: Learn and recall ---")
corrections_before = learner.correction_count()
print(f"  Corrections before: {corrections_before}")

# Simulate accountant correcting the konto to 4112 (internet)
learner.learn(internet_ocr, konto='4112', komitent_id='TEST-001')
print(f"  Corrections after:  {learner.correction_count()}")
assert learner.correction_count() == corrections_before + 1, "Correction was not saved"

# Now suggest again — should hit the learned correction
konto2, method2, conf2 = learner.suggest(internet_ocr)
print(f"  Re-suggest internet → konto={konto2}  method={method2}  confidence={conf2:.3f}")
assert method2 == 'learned_correction', f"Expected learned_correction, got {method2}"
assert konto2 == '4112', f"Expected 4112, got {konto2}"
print("  PASS")

# ------------------------------------------------------------------
# Test 3: Near-duplicate dedup (same invoice again = update, not append)
# ------------------------------------------------------------------
print("\n--- Test 3: Dedup — same invoice should update, not append ---")
learner.learn(internet_ocr, konto='4112', komitent_id='TEST-001')
assert learner.correction_count() == corrections_before + 1, \
    f"Expected no new entry, count is {learner.correction_count()}"
print("  PASS — count unchanged")

# ------------------------------------------------------------------
# Test 4: Different invoice should NOT match the internet correction
# ------------------------------------------------------------------
print("\n--- Test 4: Different invoice type should not reuse correction ---")
electricity_ocr = """
ЕВН Македонија АД
Фактура за електрична енергија
Период: Февруари 2024
kWh потрошено: 342
Износ: 3.200,00 ден
"""
konto3, method3, conf3 = learner.suggest(electricity_ocr)
print(f"  Electricity invoice → konto={konto3}  method={method3}  confidence={conf3:.3f}")
assert konto3 != '4112', f"Electricity should NOT match internet konto 4112, got {konto3}"
print("  PASS")

# ------------------------------------------------------------------
# Cleanup: remove the test correction from disk
# ------------------------------------------------------------------
import json
from pathlib import Path
corrections_path = Path('data/konto_corrections.json')
if corrections_path.exists():
    data = json.loads(corrections_path.read_text(encoding='utf-8'))
    data = [c for c in data if c.get('komitent_id') != 'TEST-001']
    corrections_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"\nCleaned up test correction from disk.")

print("\n✓ All tests passed.")
