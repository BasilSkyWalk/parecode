# M0 Truncation Measurement Report

Based on the run sessions in `session.jsonl`:

## Metrics

- **Total Initial Queries:** 12
- **Total Re-fetches (`truncate: none`):** 4
- **Re-fetch Rate:** 33.33% (4 / 12)

### Token Consumption
- **Estimated Native Tokens (Without Parecode):** 1,727,266
- **Actual Tokens Used (Initial + Re-fetches):** 1,958,171

### Token Reduction
- **Net Token Reduction:** **-13.37%** 
  *(We actually consumed 13.37% MORE tokens due to the high re-fetch cost of full files after already paying for the signature view)*

## Conclusion vs M0 Gate
- **Target:** ≥20% token reduction and <30% re-fetch rate.
- **Actual:** -13.37% token reduction and 33.33% re-fetch rate.
- **Result:** Did not meet M0 gate criteria.
