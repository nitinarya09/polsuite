# 🛡️ IFMS Data-Led Treasury Inspection & Audit Suite (v2.5)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python Version](https://img.shields.io/badge/python-3.8%2B-blue)](https://python.org)
[![Engine](https://img.shields.io/badge/Data Engine-Polars%20%7C%20ExcelJS-mintgreen)](https://pola.rs)
[![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Windows-darkgray)](#)

A high-performance, client-side, data-led audit and inspection suite designed for Treasury Officers, Auditors, and Financial Analysts. This suite enables deep-dive forensic analysis, fraud detection, and multi-file reconciliation across **Payment Order Lists (POL)**, **Voucher Level Classification (VLC)** data, and **Payroll Records** from Integrated Financial Management Information Systems (IFMS).

> [!KEY]
> 🔑 **Tool Access Passcode**: `2026`  
> Enter **`2026`** when prompted at the application access screen to unlock the inspection suite.

---

## 🌟 Key Features & Modules

### 1. 🌐 Monolithic Web Audit Suite (`Version 2.5` & `Version 2.4`)
* **Zero-Server Client-Side Architecture**: Runs entirely in the browser using HTML5, Vanilla JavaScript, and Web Workers. Your data **never leaves your local machine**.
* **High-Volume Data Support**: Seamlessly parses, merges, and analyzes millions of payment rows without server overhead.
* **30+ Advanced Audit Heuristics & Rules**:
  * **Single Account - Multiple Beneficiaries**: Detects bank accounts receiving funds under multiple distinct beneficiary names (Exact & Fuzzy Token-Sort Ratio matching).
  * **Pension + FVC Conflict Detection**: Identifies bank accounts receiving payouts concurrently from both Pension and Contingency (FVC) heads.
  * **High-Value PAY BILL Payments**: Flags individual pay-bill transfers exceeding safety thresholds (e.g., ₹2,00,000+).
  * **Multi-Party Account Sharing**: Pinpoints bank accounts shared across unrelated party codes.
  * **Composite Fraud Scoring**: Automated scoring models for *Ghost Employees* and *Vendor Fraud Signal Clusters*.
* **Export Engine**:
  * Direct export to styled Excel (`.xlsx`) workbooks via **ExcelJS**.
  * Automatic ZIP split export (CSV/TXT) for datasets exceeding Excel's 1,048,576 row limit.

---

### 2. ⚡ Standalone DDO vs Beneficiary Matcher Tool (`ddo_beneficiary_matcher.py`)
A dedicated Python GUI desktop application to determine if **Drawing and Disbursing Officers (DDOs)** are registered as payment beneficiaries in POL/VLC files.

* **Ultra-Fast Performance**: Built with **Polars** (Calamine engine) and multi-threaded C-extensions.
* **Inverted Word-to-DDO Indexing Engine**: Pre-indexes over 13,000 DDO entries to skip 99.9% of non-matching personal names instantly. Processes **4,80,000+ rows in under 2 seconds**.
* **Comprehensive Field Extraction**: Captures matched DDO details, Beneficiary Name, Similarity %, Voucher No., Date, Amount, **Account Number**, and **IFSC Code**.
* **Customizable Matching Rules**:
  * Adjustable Fuzzy Similarity Threshold Slider (50% – 100%).
  * Exact Match vs. Token-Sort Fuzzy Match modes.
* **Modern Dark UI**: Features a VS Code/IFMIS-inspired dark interface with a real-time process log console, progress bar, and instant Excel/CSV export.

---

## 📁 Repository Structure

```
Improving Audit Suite/
├── index.html                           # Root Monolithic Audit Suite
├── standalone_audit_suite.html          # Standalone Single-Page Audit Runner
├── unified_audit_suite_my working.html  # Working Unified Audit Suite Environment
├── ddo_beneficiary_matcher.py           # Standalone Python DDO vs Beneficiary Matcher GUI
├── Version 2.5/
│   ├── index.html                       # Version 2.5 Full Audit Studio
│   ├── standalone_audit_suite.html      # Version 2.5 Standalone Edition
│   └── unified_audit_suite_my working.html
├── Version 2.4/
│   ├── index.html                       # Version 2.4 Stable Edition
│   ├── standalone_audit_suite.html
│   └── unified_audit_suite_my working.html
└── README.md                            # Project Documentation
```

---

## 🚀 Getting Started

### 🌐 Running the Web Audit Suite
No installation required!
1. Open `Version 2.5/index.html` or `Version 2.5/standalone_audit_suite.html` directly in any modern Web Browser (Google Chrome, Microsoft Edge, or Firefox).
2. **Enter Access Passcode**: Type `2026` when prompted to log into the application dashboard.
3. Click **Select Files** or **Select Folder** to load your raw POL / VLC Excel files.
4. Click **Merge Data** to consolidate datasets.
5. Click **Run Analyses** to execute all 30+ audit checks simultaneously.
6. Review findings on the interactive dashboard and export results via **Export Excel** or **Export ZIP**.

---

### 🐍 Running the DDO vs Beneficiary Matcher Tool

#### Prerequisites
Make sure Python 3.8 or higher is installed. Install the required dependencies:

```bash
pip install polars rapidfuzz openpyxl pandas
```

#### Launching the Application
Run the Python script directly from your terminal or command prompt:

```bash
python ddo_beneficiary_matcher.py
```

#### Workflow:
1. **Load DDO List**: Browse and select your DDO reference text file (e.g., `ddo.txt` with standard `0100121003-Name` format).
2. **Select POL File(s)**: Load one or more merged POL files (`.xlsx` or `.csv`).
3. **Select Column**: Choose the column containing the beneficiary/party name (defaults to `Party Name` or `Beneficiary Name`).
4. **Choose Matching Mode**: Set to *Fuzzy Match* (default 85% threshold) or *Exact Match*.
5. **Run Analysis**: Click **Run Matching Analysis**. View instant matches in the interactive grid and export results using **Export Results**.

---

## 🛠️ Data Standards & Input Formats

### DDO Reference File (`ddo.txt`)
The DDO reference file should contain one DDO entry per line formatted as:
```text
0100121003-Collector (Local Election) Balaghat
1403402008-Executive Engineer PHE Division Gwalior
```

### Merged POL / Audit Files (`.xlsx` / `.csv`)
The suite automatically recognizes standard IFMS columns:
* **Party / Beneficiary Name**: `Party Name`, `Beneficiary Name`, `Party_Name`
* **Account Number**: `Account Number`, `Account No`, `Account_No`, `Bank Account No`
* **IFSC Code**: `IFSC Code`, `IFSC`, `IFSC_Code`, `IFSC Code.`
* **Voucher Details**: `Voucher No.`, `Raw Voucher Number`, `Voucher Date`, `Amount`
* **DDO Information**: `DDO Code`, `DDO Name`, `DDO (VLC)`

---

## 🏛️ Monolithic Architecture Notice
> [!IMPORTANT]
> The HTML files in this repository (`index.html`, `standalone_audit_suite.html`, `unified_audit_suite_my working.html`) are designed as **standalone unminified monolithic applications**. Modifications, enhancements, and worker updates are directly patched into the unminified `<script id="audit-worker-code">` blocks and global function definitions to preserve zero-dependency distribution.

---

## 🤝 Contributing & License
Contributions, feedback, and audit heuristic recommendations are welcome! Please feel free to submit issues or pull requests.

This project is licensed under the **MIT License**.
