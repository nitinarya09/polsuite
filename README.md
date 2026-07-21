# IFMS Treasury — Integrated Audit System v2.3

**A client-side, offline-capable audit engine for IFMS Payment Order List (POL) data.**  
No server. No installation. Open the HTML file and audit.

---

## What Is This?

The IFMS Treasury Integrated Audit System is a browser-based tool that analyses IFMS POL (Payment Order List) export data to automatically detect financial irregularities, duplicate payments, fraud patterns, and data quality issues — without sending data to any external server.

All processing happens locally inside a Web Worker in your browser. Your data never leaves your machine.

---

## How to Open

1. Go to the folder: `D:\BUILDING and TESTING\Improving Audit Suite\Version 2.3\`
2. Open **`standalone_audit_suite.html`** (or `index.html`) in **Firefox or Chrome**
3. The badge in the header should show **SUITE V2.3**

> **No internet required.** Works fully offline.

---

## Loading Your Data

### Step 1 — Load Files
Click **Load Files** or **Select Folder**.
- Accepts: `.xlsx`, `.xls`, `.csv`, `.txt` (pipe/comma/tab delimited)
- You can load multiple files at once — they are merged automatically
- Duplicate rows across files are de-duplicated

### Step 2 — Merge Data *(optional)*
If you loaded split files (e.g., month-wise exports), click **Merge Data** to combine them into a single unified dataset before running checks.

### Step 3 — Run Analyses
Click **Run Analyses** or go to the **Results** tab and select individual checks to run.

### Step 4 — Export
- **Excel** — Download flagged records as a formatted `.xlsx` file
- **ZIP (Excel)** — All check results in separate sheets, zipped
- **ZIP (CSVs)** — Same, but as CSV files
- **ZIP (TXTs)** — Plain text format

---

## Available Audit Checks

### 🔴 Critical / High-Value Checks

| Check Name | What It Detects |
|---|---|
| **Duplicate Pay Bill (Same Month)** | Same account receiving multiple Pay Bill payments in the same calendar month |
| **Duplicate Payment (No Limit)** | Same account + IFSC + amount appearing more than once in the same financial year |
| **Cross-DDO Same Account** | One bank account receiving Pay Bills from multiple DDOs — possible ghost employee |
| **Post-Death Payments** | Salary/Pay Bill payments continuing after a DCRG (gratuity) payment — ghost employee after retirement/death |
| **March Rush — New Account** | Accounts whose **first-ever payment** is in March above ₹50,000 — year-end budget-exhaustion fraud |
| **Annual Vendor Cap per DDO** | Vendors receiving more than ₹10 lakh from a single DDO in one financial year via 5+ payments |
| **Salary Jump** | Month-on-month Pay Bill jump of more than 30% without an ARREAR/ADVANCE justification |

---

### 🟠 Important Checks

| Check Name | What It Detects |
|---|---|
| **DDO March Rush** | DDOs spending 40%+ of annual payments in the last 15 days of March (16–31 Mar) |
| **Rapid Succession Payments** | More than 4 payments to one account within any rolling 30-day window |
| **Split Billing** | Multiple payments to the same vendor/DDO within a short window that cross an approval threshold |
| **Near Approval Limits** | Payments within 5% below a sanction threshold (₹5K, ₹10K, ₹25K, ₹50K, ₹1L, ₹5L, ₹10L) |
| **Benford's Law** | Statistical first-digit frequency analysis on non-Pay Bill payments |
| **Round Amounts** | Round payments; amounts exactly at procurement threshold limits (₹20K, ₹50K, ₹2.5L) scored highest |
| **TA Bills** | Cumulative TA claim per employee per DDO per year exceeding limits |
| **FVC Bill Validation** | FVC payments below the ₹5,00,000 threshold requiring additional scrutiny |
| **Multiple GPF/DPF Bills** | More than one GPF deduction row for the same account in the same calendar month |

---

### 🟡 Supporting Checks

| Check Name | What It Detects |
|---|---|
| **Same Day Payments** | Same account receiving multiple payments on the same calendar day (above ₹5,000) |
| **Day-of-Week Concentration** | DDOs where 60%+ of payments fall on a single weekday — possible batch manipulation |
| **Vendor Concentration** | Top-10 vendors receiving a disproportionate share (>50%) of total payments |
| **Suspicious Beneficiary Names** | Names containing TEST, DUMMY, NULL, XXXX, TEMP, SAMPLE, or purely numeric |
| **Inactive Account Reactivation** | Accounts dormant for 6+ months that suddenly receive payments |
| **Cross-DDO Payments** | Payments interleaved across DDOs for the same account in a suspicious pattern |
| **Medical Bills** | Medical reimbursement claims flagged for scrutiny |
| **High Pay Bill** | Pay Bill payments above ₹2,00,000 in a single transaction |

---

### 📊 Summary / Reference Reports

| Check Name | What It Produces |
|---|---|
| **Account-Wise Total** | Total payments per bank account across the dataset |
| **Paybill FVC Conflict** | Accounts receiving both Pay Bill and FVC — possible dual employment |
| **Paybill + Scholarship Conflict** | Accounts receiving both Pay Bill and Grant/Scholarship |
| **Pension + Scholarship Conflict** | Accounts receiving both Pension and Scholarship |
| **Pension + FVC Conflict** | Accounts receiving both Pension and FVC |

---

## Maximize Panel

Click the **⤢** icon in the top-right corner of any results panel to expand it to full screen.
Press **Escape** or click the icon again to restore.

---

## Configurable Settings

All thresholds can be adjusted without changing code. Open the **⚙ Settings** panel (gear icon, bottom-right) and override any value:

| Setting Key | Default | Description |
|---|---|---|
| `same_day_min_amount` | 5,000 | Minimum amount for same-day duplicate check |
| `split_billing_window_days` | 3 | Day window for split-billing detection |
| `rapid_window_days` | 30 | Rolling window size for burst payment check |
| `rapid_window_count` | 4 | Min payments in window to trigger burst flag |
| `dow_concentration_pct` | 60 | % threshold for day-of-week concentration |
| `dow_min_payments` | 50 | Minimum payments for DOW check (statistical floor) |
| `march_new_account_limit` | 50,000 | Minimum amount for March new-account flag |
| `annual_vendor_ddo_cap` | 10,00,000 | Max vendor payout from one DDO per year |
| `annual_vendor_min_count` | 5 | Minimum payments to trigger vendor cap check |
| `salary_jump_pct` | 0.30 | Relative jump threshold for salary-jump check (30%) |
| `march_rush_pct` | 0.40 | Fraction of annual spend in last 15 days of March |
| `vendor_min_txn_amount` | 1,000 | Minimum amount for vendor concentration analysis |
| `approval_thresholds` | [5K…10L] | Sanction limit thresholds |
| `approval_band_pct` | 5.0 | Proximity band (%) below each threshold |
| `dup_window_days` | 90 | Date window for name+amount duplicate check |
| `round_concentration_pct` | 20 | % of round amounts to trigger high-concentration warning |
| `ta_limit_cumul` | 50,000 | Cumulative annual TA limit per employee per DDO |
| `vendor_concentration_pct` | 50 | Top-10 vendor share (%) to trigger HIGH concentration |
| `paybill_high_value_limit` | 2,00,000 | Pay Bill amount considered high-value |

---

## Understanding the Output

### Risk Scores

| Score Range | Severity | Meaning |
|---|---|---|
| 80–100 | 🔴 IRREGULAR | High confidence — warrants immediate attention |
| 60–79 | ⚠️ WARNING | Suspicious — review with supporting documents |
| 40–59 | 🟡 REVIEW | Flag for audit scrutiny |
| 1–39 | ℹ️ INFO | Low risk — statistical/informational |

### Key Output Columns

| Column | Description |
|---|---|
| `Account_No` | Bank account number |
| `Beneficiary_Name` | Party/payee name |
| `DDO_Code` | Drawing and Disbursing Officer code |
| `DDO_Name` | DDO name |
| `Amount` | Payment amount (₹) |
| `Date` | Date of payment |
| `Bill_Type` | Type of bill (PAY BILL, FVC, PENSION, etc.) |
| `AUDIT_FLAG` | Severity label |
| `Why_Flagged` | Short one-line reason (scannable) |
| `AUDIT_ISSUE` | Full detailed reason with amounts, dates, context |
| `Risk_Score` | Numeric risk score (1–100) |
| `UTR_No` | Unique Transaction Reference |
| `IFSC` | Bank IFSC code |
| `Source_File` | Which input file this record came from |

---

## Tips for Best Results

1. **Load a full financial year** — Checks like Annual Vendor Cap, March Rush, and Salary Jump need 12 months of data to be meaningful.

2. **Use merged/combined exports** — Load all months together rather than running checks month-wise.

3. **Sort by Risk_Score descending** — Click the `Risk_Score` column header to bring highest-risk records to the top.

4. **Use the search box** — Filter flagged records by account number, DDO code, or party name directly in the Results panel before exporting.

5. **Check the Findings tab** — Each check produces a **Findings** summary (e.g., "DDO X: ₹1.2 Cr spent in last 15 days of March") — review this first before reading individual rows.

6. **Press F12 → Console** to monitor for JavaScript errors during large dataset processing.

---

## File Structure

```
Version 2.3\
├── standalone_audit_suite.html        ← Use this for offline standalone use
├── index.html                         ← Alternative entry point (same engine)
├── unified_audit_suite_my working.html  ← Unified/payroll variant
├── engine.js                          ← Standalone audit engine v2.3
└── README.md                          ← This file
```

> All three HTML files are **self-contained** — the audit engine is embedded inside each.

---

## Version History

| Version | Date | Highlights |
|---|---|---|
| **v2.3** | July 2026 | 9 bug fixes (DDO count, GPF false positives, TA year parsing, DCRG keywords); 5 new checks (March Rush, Vendor Cap, Suspicious Names, Salary Jump, DDO Budget Exhaustion); sliding-window rapid payments; Benford's Law and Round Amounts exclude salary rows; all thresholds configurable |
| v2.2 | Prior | Previous release |

---

## Known Limitations

- **Date format sensitivity** — Works best with `DD-MM-YYYY` or `DD/MM/YYYY`. Ambiguous formats may be mis-parsed.
- **Large datasets** — Files over 5 lakh rows may slow the browser. Pre-filter if needed.
- **Holiday calendar** — Pre-loaded with Central Government + Madhya Pradesh gazetted holidays. District-level local holidays are not included.
- **GPF keyword coverage** — Flags bills containing: `GPF`, `DPF`, `DPF/GPF`, `PROVIDENT FUND`, `PF ADVANCE`, `GPF ADVANCE`. Non-standard abbreviations may be missed.
