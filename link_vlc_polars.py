# -*- coding: utf-8 -*-
"""
IFMS POL & VLC Data Linker
High-performance rust-backed data joiner using Polars.
Includes a premium dark-themed GUI and full automated CLI support.
"""

import os
import sys
import time
import queue
import argparse
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, font, ttk
import polars as pl

# Treasury numeric code to character code translation mapping
K3_MAP = {
    "010":"BAL","020":"BAD","030":"BET","040":"BHI","050":"BPL","051":"VIN","052":"VAL","054":"CTB",
    "060":"CHA","070":"CHI","080":"DAM","090":"DAT","100":"DEW","110":"DHA","120":"DIN","130":"GUN",
    "140":"GWL","141":"MML","150":"HAR","160":"HOS","170":"IND","171":"INC","180":"JBP","181":"JBC",
    "190":"JHA","200":"KAT","210":"KHA","220":"KAR","230":"MAN","240":"MND","250":"MOR","260":"NAR",
    "270":"NEE","280":"PAN","290":"RIS","300":"RAJ","310":"RAT","320":"REW","330":"SAG","340":"SAT",
    "350":"SEH","360":"SEO","370":"SHA","380":"SAJ","390":"SHI","400":"SHE","410":"SID","420":"TIK",
    "430":"UJJ","440":"UMA","450":"VID","460":"ANU","470":"ASH","480":"BUR","490":"ALI","500":"SNG",
    "510":"AGR","520":"NIW"
}

# Dark theme colors (matching Audit Suite Premium dark mode)
BG_MAIN = "#0f172a"      # slate-900
BG_PANEL = "#1e293b"     # slate-800
ACCENT = "#f59e0b"       # amber-500
ACCENT_HOVER = "#d97706" # amber-600
TEXT_MAIN = "#f8fafc"    # slate-50
TEXT_MUTED = "#94a3b8"   # slate-400
BORDER_COLOR = "#334155" # slate-700
BG_TERMINAL = "#020617"  # slate-950

def map_treasury_code(val, name=""):
    """Translates numeric treasury codes to their 3-letter alphabetical representations."""
    val_str = str(val).strip()
    if not val_str or val_str.lower() in ("none", "nan", "null", ""):
        val_str = str(name).strip()
    
    # Handle decimals from excel import (e.g. "50.0")
    if val_str.endswith(".0"):
        val_str = val_str[:-2]
        
    if val_str.isdigit():
        if len(val_str) == 1:
            code = "0" + val_str + "0"
        elif len(val_str) == 2:
            code = "0" + val_str
        elif len(val_str) == 3:
            code = val_str
        else:
            code = val_str[:3]
        return K3_MAP.get(code, val_str.upper())
    return val_str.upper()

def get_numeric_try_code(val):
    val_str = str(val).strip()
    if not val_str or val_str.lower() in ("none", "nan", "null", ""):
        return ""
    if val_str.endswith(".0"):
        val_str = val_str[:-2]
    if val_str.isdigit():
        if len(val_str) == 1:
            return "0" + val_str + "0"
        if len(val_str) == 2:
            return "0" + val_str
        if len(val_str) == 3:
            return val_str
        return val_str[:3]
    for num, char in K3_MAP.items():
        if char == val_str.upper():
            return num
    return val_str

def clean_voucher_date(val):
    if val is None:
        return ""
    s = str(val).strip()
    if not s:
        return ""
    if " " in s:
        s = s.split(" ")[0].strip()
    if "T" in s:
        s = s.split("T")[0].strip()
    if ":" in s or s == "00:00.0" or s == "00:00:00" or "1899-12-30" in s:
        return ""
    import re
    ymd = re.match(r"^(\d{4})[-/](\d{2})[-/](\d{2})$", s)
    if ymd:
        return f"{ymd.group(3)}/{ymd.group(2)}/{ymd.group(1)}"
    dmy = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$", s)
    if dmy:
        d = dmy.group(1).zfill(2)
        m = dmy.group(2).zfill(2)
        return f"{d}/{m}/{dmy.group(3)}"
    return s

def run_linker_engine(pol_path, vlc_path, out_path, log_callback, progress_callback):
    """Executes the core Polars linking engine in a separate thread."""
    start_time = time.time()
    try:
        log_callback("[INFO] Starting linking engine...")
        progress_callback(5)
        
        # 1. Load POL Merged file
        log_callback(f"[INFO] Reading POL file: {os.path.basename(pol_path)}")
        if pol_path.lower().endswith(('.xlsx', '.xls')):
            import pandas as pd
            pd_df = pd.read_excel(pol_path, dtype=str)
            for col in pd_df.columns:
                pd_df[col] = pd_df[col].astype(str).fillna('').replace(['nan', 'NaN', 'None', 'nan.0'], '')
            pol_df = pl.from_pandas(pd_df)
        else:
            skip_rows = 0
            try:
                with open(pol_path, 'r', encoding='utf-8', errors='ignore') as f:
                    first_line = f.readline()
                    if first_line.startswith('sep='):
                        skip_rows = 1
            except Exception:
                pass
            pol_df = pl.read_csv(
                pol_path,
                skip_rows=skip_rows,
                infer_schema_length=100000,
                null_values=["", "NA", "null", "-", "NaN"],
                ignore_errors=True,
                truncate_ragged_lines=True
            )
            
        # Strip Excel text-formula wrapping (e.g. ="123") if present
        for col in pol_df.columns:
            if pol_df[col].dtype == pl.String:
                pol_df = pol_df.with_columns(
                    pl.col(col)
                    .str.replace(r'^="', '')
                    .str.replace(r'"$', '')
                )
        
        if "Voucher Date" in pol_df.columns:
            pol_df = pol_df.with_columns(
                pl.col("Voucher Date")
                .fill_null("")
                .cast(pl.String)
                .map_elements(clean_voucher_date, return_dtype=pl.String)
            )
            
        if "Try Code" in pol_df.columns:
            pol_df = pol_df.with_columns(
                pl.col("Try Code")
                .fill_null("")
                .cast(pl.String)
                .map_elements(get_numeric_try_code, return_dtype=pl.String)
            )

        log_callback(f"[INFO] Loaded {pol_df.height:,} POL records.")
        progress_callback(20)

        # Find columns in POL
        pol_cols = pol_df.columns
        def find_col(possible_names):
            for name in possible_names:
                for col in pol_cols:
                    clean_col = col.lower().replace("_", "").replace(" ", "").replace(".", "")
                    clean_name = name.lower().replace("_", "").replace(" ", "").replace(".", "")
                    if clean_col == clean_name:
                        return col
            return None

        v_col = find_col(["voucher_no", "voucherNo", "vouno", "vou_no", "voucherno"])
        try_col = find_col(["try_code", "trycode", "treasury_code", "treasurycode"])
        try_name_col = find_col(["try_name", "tryname", "treasury_name", "treasuryname"])
        m_col = find_col(["month", "month_in"])
        y_col = find_col(["year", "year_in"])
        mh_col = find_col(["major_head", "majorhead", "mhcd"])
        
        # Validate critical columns
        missing = []
        if not v_col: missing.append("Voucher No")
        if not try_col: missing.append("Treasury Code")
        if not m_col: missing.append("Month")
        if not y_col: missing.append("Year")
        if not mh_col: missing.append("Major Head")
        
        if missing:
            raise ValueError(f"Required columns missing in POL file: {', '.join(missing)}")

        log_callback("[INFO] Column mapping detected successfully:")
        log_callback(f"  - Voucher: {v_col}")
        log_callback(f"  - Treasury: {try_col}")
        log_callback(f"  - Month/Year: {m_col}/{y_col}")
        log_callback(f"  - Major Head: {mh_col}")
        
        # Extract unique active treasuries from POL for memory pre-filtering
        norm_tries = set()
        for t_val in pol_df.select(try_col).unique().to_series().to_list():
            t_norm = map_treasury_code(t_val)
            if t_norm:
                norm_tries.add(t_norm)
        
        log_callback(f"[INFO] Active treasuries detected in POL file: {list(norm_tries)}")
        
        # 2. Lazy scan the VLC CSV file (only read columns of interest to save RAM)
        log_callback(f"[INFO] Scanning VLC CSV file: {os.path.basename(vlc_path)}")
        vlc_cols = ["TRY_CD", "MONTH", "YEAR", "VOU_NO", "MHCD", "GNCD", "SMCD", "MICD", "GHCD", "SHCD", "DHCD", "SDCD", "AMOUNT", "DDO_CD"]
        
        vlc_lazy = pl.scan_csv(
            vlc_path,
            infer_schema_length=50000,
            null_values=["", "NA", "null"],
            ignore_errors=True,
            truncate_ragged_lines=True
        ).select(vlc_cols)
        
        # Apply performance-boosting lazy pre-filter on treasury code
        if norm_tries:
            vlc_lazy = vlc_lazy.filter(pl.col("TRY_CD").str.to_uppercase().is_in(list(norm_tries)))
        
        # Cast VLC columns and build join key
        log_callback("[INFO] Building index keys on VLC lazy dataframe...")
        vlc_prepared = vlc_lazy.with_columns([
            pl.col("MONTH").cast(pl.Int32),
            pl.col("YEAR").cast(pl.Int32),
            pl.col("VOU_NO").cast(pl.Int32),
            pl.col("MHCD").cast(pl.String).str.strip_chars(),
            pl.col("TRY_CD").cast(pl.String).str.strip_chars().str.to_uppercase()
        ]).with_columns([
            (pl.col("TRY_CD") + "|" +
             pl.col("MONTH").cast(pl.String) + "|" +
             pl.col("YEAR").cast(pl.String) + "|" +
             pl.col("MHCD") + "|" +
             pl.col("VOU_NO").cast(pl.String)).alias("join_key")
        ])
        
        progress_callback(40)
        
        # 3. Prepare POL side
        log_callback("[INFO] Building index keys on POL dataframe...")
        try_name_arg = try_name_col if try_name_col else try_col
        pol_prepared = pol_df.with_columns([
            pl.col(try_col).cast(pl.String).map_elements(lambda x: map_treasury_code(x, ""), return_dtype=pl.String).alias("TRY_CD_norm"),
            pl.col(m_col).cast(pl.Int32).alias("MONTH_norm"),
            pl.col(y_col).cast(pl.Int32).alias("YEAR_norm"),
            pl.col(mh_col).cast(pl.String).str.strip_chars().alias("MHCD_norm"),
            pl.col(v_col).cast(pl.Int32).alias("VOU_NO_norm")
        ]).with_columns([
            (pl.col("TRY_CD_norm") + "|" +
             pl.col("MONTH_norm").cast(pl.String) + "|" +
             pl.col("YEAR_norm").cast(pl.String) + "|" +
             pl.col("MHCD_norm") + "|" +
             pl.col("VOU_NO_norm").cast(pl.String)).alias("join_key")
        ])
        
        progress_callback(60)

        # 4. Materialize VLC data and run Join
        log_callback("[INFO] Loading VLC records into memory and joining datasets...")
        vlc_materialized = vlc_prepared.collect()
        log_callback(f"[INFO] Materialized {vlc_materialized.height:,} VLC records successfully.")
        
        # Group and aggregate VLC records by join_key to prevent row expansion in left join
        log_callback("[INFO] Grouping and aggregating VLC splits on join_key...")
        
        vlc_agg_exprs = []
        for c in ["GNCD", "SMCD", "MICD", "GHCD", "SHCD", "DHCD", "SDCD", "DDO_CD"]:
            if c in vlc_materialized.columns:
                clean_val = pl.col(c).cast(pl.String).fill_null("").str.strip_chars()
                vlc_agg_exprs.append(
                    clean_val
                    .filter(clean_val != "")
                    .unique()
                    .str.join(", ")
                    .alias(c)
                )
        if "AMOUNT" in vlc_materialized.columns:
            vlc_agg_exprs.append(
                pl.col("AMOUNT").fill_null(0.0).sum().alias("AMOUNT")
            )
            
        vlc_unique = vlc_materialized.group_by("join_key").agg(vlc_agg_exprs)
        
        joined = pol_prepared.join(
            vlc_unique.select([
                "join_key", "GNCD", "SMCD", "MICD", "GHCD", "SHCD", "DHCD", "SDCD", "AMOUNT", "DDO_CD"
            ]),
            on="join_key",
            how="left"
        )
        
        # Post process
        joined = joined.with_columns([
            pl.when(pl.col("DHCD").is_not_null())
            .then(pl.lit("YES"))
            .otherwise(pl.lit("NO"))
            .alias("VLC_Linked"),
            pl.col("AMOUNT").fill_null(0.0).alias("Amount (VLC)"),
            pl.col("DDO_CD").fill_null("").alias("DDO (VLC)")
        ]).drop(["AMOUNT", "DDO_CD", "join_key", "TRY_CD_norm", "MONTH_norm", "YEAR_norm", "MHCD_norm", "VOU_NO_norm"])
        
        if "Amount" in joined.columns:
            joined = joined.rename({"Amount": "Amount (POL)"})
            
        progress_callback(80)
        
        # Drop unwanted columns
        drop_cols = ["Payment Mode", "Source File", "Source_DDO_File", "Sr No"]
        joined = joined.drop([c for c in drop_cols if c in joined.columns])
        
        # Reorder columns dynamically
        all_cols = joined.columns
        preferred_order = [
            "Account Number", "Party Code", "Party Name",
            "DDO Code", "DDO (VLC)", "DDO Name",
            "Try Code", "Try Name", "Major Head",
            "GNCD", "SMCD", "MICD", "GHCD", "SHCD", "DHCD", "SDCD",
            "Voucher No.", "Month", "Year", "Raw Voucher Number", "Voucher Date",
            "Amount (POL)", "Amount (VLC)",
            "Bill Type", "Bill Ref No", "UTR No.", "VLC_Linked"
        ]
        
        ordered_cols = []
        for c in preferred_order:
            found_col = None
            for ac in all_cols:
                if ac.lower().replace(".", "").replace(" ", "").replace("_", "") == c.lower().replace(".", "").replace(" ", "").replace("_", ""):
                    found_col = ac
                    break
            if found_col and found_col not in ordered_cols:
                ordered_cols.append(found_col)
                
        for ac in all_cols:
            if ac not in ordered_cols:
                ordered_cols.append(ac)
                
        joined = joined.select(ordered_cols)
        
        # Print stats
        yes_count = joined.filter(pl.col("VLC_Linked") == "YES").height
        no_count = joined.filter(pl.col("VLC_Linked") == "NO").height
        pct_linked = (yes_count / joined.height * 100) if joined.height > 0 else 0
        log_callback(f"[SUCCESS] Linking complete: {yes_count:,} records matched ({pct_linked:.1f}%), {no_count:,} records unmatched.")

        # 5. Save Output
        log_callback(f"[INFO] Saving linked results to: {out_path}")
        float_cols = ["Amount (POL)", "Amount (VLC)"]
        for col in float_cols:
            if col in joined.columns:
                joined = joined.with_columns(pl.col(col).cast(pl.Float64, strict=False))
                
        if out_path.lower().endswith(('.xlsx', '.xls')):
            import pandas as pd
            joined_pd = joined.to_pandas()
            joined_pd.to_excel(out_path, index=False)
        else:
            # If CSV, format key identifier columns as Excel-compatible text formulas
            # to prevent Excel from auto-converting to scientific notation or truncating leading zeros
            csv_df = joined.clone()
            text_cols = ["Account Number", "Party Code", "DDO Code", "DDO (VLC)", "Try Code", "Voucher No.", "UTR No."]
            for col in text_cols:
                if col in csv_df.columns:
                    csv_df = csv_df.with_columns(
                        pl.when(pl.col(col).is_not_null() & (pl.col(col).str.strip_chars() != ""))
                        .then(pl.lit("=\"") + pl.col(col).cast(pl.String) + pl.lit("\""))
                        .otherwise(pl.col(col))
                        .alias(col)
                    )
            csv_df.write_csv(out_path)
            
        progress_callback(100)
        elapsed = time.time() - start_time
        log_callback(f"[SUCCESS] Linker completed successfully in {elapsed:.2f} seconds.")
        log_callback(f"[SUCCESS] Saved {joined.height:,} rows to file.")
        
    except Exception as e:
        log_callback(f"[ERROR] Linking aborted: {e}")
        progress_callback(-1)

def run_vlc_splitter(pol_path, vlc_path, out_path, log_callback, progress_callback):
    """Filters the VLC CSV file by the active treasuries in the POL file and saves the trimmed VLC CSV."""
    start_time = time.time()
    try:
        log_callback("[INFO] Starting VLC CSV splitter preprocessor...")
        progress_callback(10)
        
        # 1. Load POL Merged file
        log_callback(f"[INFO] Reading POL file to detect active treasuries...")
        if pol_path.lower().endswith(('.xlsx', '.xls')):
            import pandas as pd
            pd_df = pd.read_excel(pol_path)
            for col in pd_df.columns:
                if pd_df[col].dtype == 'object':
                    pd_df[col] = pd_df[col].astype(str).fillna('')
            pol_df = pl.from_pandas(pd_df)
        else:
            skip_rows = 0
            try:
                with open(pol_path, 'r', encoding='utf-8', errors='ignore') as f:
                    first_line = f.readline()
                    if first_line.startswith('sep='):
                        skip_rows = 1
            except Exception:
                pass
            pol_df = pl.read_csv(
                pol_path,
                skip_rows=skip_rows,
                infer_schema_length=100000,
                null_values=["", "NA", "null", "-", "NaN"],
                ignore_errors=True,
                truncate_ragged_lines=True
            )
            
        progress_callback(35)
        
        # Find try_col
        pol_cols = pol_df.columns
        def find_col(possible_names):
            for name in possible_names:
                for col in pol_cols:
                    clean_col = col.lower().replace("_", "").replace(" ", "").replace(".", "")
                    clean_name = name.lower().replace("_", "").replace(" ", "").replace(".", "")
                    if clean_col == clean_name:
                        return col
            return None
        
        try_col = find_col(["try_code", "trycode", "treasury_code", "treasurycode"])
        if not try_col:
            raise ValueError("Could not find Treasury Code column in POL file.")
            
        # Extract unique active treasuries
        norm_tries = set()
        for t_val in pol_df.select(try_col).unique().to_series().to_list():
            t_norm = map_treasury_code(t_val)
            if t_norm:
                norm_tries.add(t_norm)
                
        log_callback(f"[INFO] Detected active treasuries: {list(norm_tries)}")
        progress_callback(50)
        
        # 2. Scan VLC CSV lazily and filter by active treasuries
        log_callback(f"[INFO] Scanning VLC CSV and filtering rows...")
        vlc_lazy = pl.scan_csv(
            vlc_path,
            infer_schema_length=50000,
            null_values=["", "NA", "null"],
            ignore_errors=True,
            truncate_ragged_lines=True
        )
        
        vlc_filtered = vlc_lazy.filter(
            pl.col("TRY_CD").str.to_uppercase().is_in(list(norm_tries))
        ).collect()
        
        log_callback(f"[INFO] Extracted {vlc_filtered.height:,} matching rows from VLC database.")
        progress_callback(80)
        
        # 3. Save trimmed CSV
        log_callback(f"[INFO] Saving trimmed VLC file to: {out_path}")
        vlc_filtered.write_csv(out_path)
        
        progress_callback(100)
        elapsed = time.time() - start_time
        log_callback(f"[SUCCESS] VLC CSV splitter finished successfully in {elapsed:.2f} seconds.")
        log_callback(f"[SUCCESS] Trimmed VLC file size reduced to {os.path.getsize(out_path)/(1024*1024):.1f} MB.")
        
    except Exception as e:
        log_callback(f"[ERROR] Splitter aborted: {e}")
        progress_callback(-1)

# POL Merger Backend
def run_pol_merger(input_dir_or_files, out_path, remove_dups=True, allow_multi_treasury=False, log_callback=print, progress_callback=lambda x: None):
    """Merges raw POL files (Excel/CSV) from a directory (recursively) or list of files, standardizes columns, deduplicates, and saves."""
    start_time = time.time()
    try:
        log_callback("[INFO] Starting raw POL merger...")
        progress_callback(10)
        
        # 1. Gather files
        files = []
        if isinstance(input_dir_or_files, str):
            if os.path.isdir(input_dir_or_files):
                # Recursively walk subdirectories to find files
                for root_dir, _, filenames in os.walk(input_dir_or_files):
                    for f in filenames:
                        # Skip temporary files, hidden files, and pre-existing master/merged output files
                        if (f.lower().endswith(('.csv', '.xlsx', '.xls')) and 
                            not f.startswith('~$') and 
                            not f.startswith('.') and 
                            not f.lower().startswith(('master_file', 'ifms_merged', 'unified_audit', 'standalone_audit'))):
                            files.append(os.path.join(root_dir, f))
            elif ";" in input_dir_or_files:
                files = [f.strip() for f in input_dir_or_files.split(";") if f.strip()]
            else:
                if os.path.exists(input_dir_or_files):
                    files = [input_dir_or_files]
        elif isinstance(input_dir_or_files, list):
            files = input_dir_or_files
            
        if not files:
            raise ValueError("No valid POL files found to merge.")
            
        log_callback(f"[INFO] Found {len(files)} files to merge.")
        progress_callback(20)
        
        # Helper to find column matching any possible names
        def get_column_mapping(df_cols):
            mapping = {}
            # Canonical key to possible headers mapping
            expected = {
                "Sr No": ["sr no", "sr_no", "srno", "sl no", "sl_no", "slno", "sno", "sr.no"],
                "Account Number": ["account number", "account_number", "accountno", "account no", "account_no", "bank ac no", "bank_ac_no", "bankacno", "account"],
                "Party Code": ["party code", "partycode", "party_code", "beneficiary code", "beneficiary_code"],
                "Party Name": ["party name", "partyname", "party_name", "beneficiary name", "beneficiary_name"],
                "Raw Voucher Number": ["voucher number", "vouchernumber", "raw voucher number", "rawvouchernumber", "raw_voucher_number", "raw voucher no", "rawvoucherno", "raw_voucher_no", "voucherno", "vouno", "voucher_no"],
                "Voucher Date": ["voucher date", "voucherdate", "voucher_date", "date of payment", "date_of_payment", "date"],
                "Amount": ["amount", "amount paid", "amount_paid", "amountpaid", "payment"],
                "Payment Mode": ["payment mode", "paymentmode", "payment_mode"],
                "Bill Type": ["bill type", "billtype", "bill_type"],
                "Bill Ref No": ["bill ref no", "billrefno", "bill_ref_no", "bill reference no", "billreferenceno", "bill reference no."],
                "Advice Number": ["advice number", "advicenumber", "advice no", "adviceno", "advice_no"],
                "Cheque Number": ["cheque number", "chequenumber", "cheque no", "chequeno", "cheque_no"],
                "UTR No.": ["utr no.", "utr no", "utrno", "utr_no", "utr", "utr number", "utrnumber"],
                "DDO Code": ["ddo code", "ddocode", "ddo_code", "ddo"],
                "DDO Name": ["ddo name", "ddoname", "ddo_name"],
                "Source File": ["source file", "sourcefile", "source_file"]
            }
            
            for canonical, aliases in expected.items():
                for col in df_cols:
                    clean_col = col.lower().replace("_", "").replace(" ", "").replace(".", "").strip()
                    for alias in aliases:
                        clean_alias = alias.lower().replace("_", "").replace(" ", "").replace(".", "").strip()
                        if clean_col == clean_alias:
                            mapping[col] = canonical
                            break
            return mapping

        def extract_ddo_from_df(pd_df):
            ddo_code = ""
            ddo_name = ""
            candidates = []
            if len(pd_df) > 0:
                for i in range(min(5, len(pd_df))):
                    candidates.append(str(pd_df.iloc[i, 0]))
            if len(pd_df.columns) > 0:
                candidates.append(str(pd_df.columns[0]))
            for val in candidates:
                if ">BANK >>BRANCH -->" in val or ">BANK>>BRANCH-->" in val:
                    try:
                        parts = val.split("-->")
                        if len(parts) > 1:
                            ddo_part = parts[1].split(":")
                            ddo_code = ddo_part[0].strip()
                            ddo_name = ddo_part[1].split(">>")[0].strip()
                            break
                    except Exception:
                        pass
            return ddo_code, ddo_name

        # 2. Parse all files
        dfs = []
        parsed_count = 0
        import pandas as pd
        for idx, f in enumerate(files):
            try:
                log_callback(f"[INFO] Parsing ({idx+1}/{len(files)}): {os.path.basename(f)}")
                ddo_code, ddo_name = "", ""
                if f.lower().endswith(('.xlsx', '.xls')):
                    pd_df = pd.read_excel(f, dtype=str)
                    ddo_code, ddo_name = extract_ddo_from_df(pd_df)
                    for col in pd_df.columns:
                        pd_df[col] = pd_df[col].astype(str).fillna('').replace(['nan', 'NaN', 'None', 'nan.0'], '')
                    df = pl.from_pandas(pd_df)
                else:
                    df = pl.read_csv(
                        f, 
                        infer_schema_length=50000, 
                        null_values=["", "NA", "null", "-", "NaN"],
                        ignore_errors=True,
                        truncate_ragged_lines=True
                    )
                    # For CSV, try to extract DDO from first few rows
                    try:
                        head_df = df.head(5)
                        if len(head_df.columns) > 0:
                            first_col = head_df.columns[0]
                            candidates = [str(first_col)] + [str(x) for x in head_df[first_col].to_list()]
                            for val in candidates:
                                if ">BANK >>BRANCH -->" in val or ">BANK>>BRANCH-->" in val:
                                    parts = val.split("-->")
                                    if len(parts) > 1:
                                        ddo_part = parts[1].split(":")
                                        ddo_code = ddo_part[0].strip()
                                        ddo_name = ddo_part[1].split(">>")[0].strip()
                                        break
                    except Exception:
                        pass
                
                # Normalize column names
                col_map = get_column_mapping(df.columns)
                rename_dict = {}
                for k, v in col_map.items():
                    rename_dict[k] = v
                df = df.rename(rename_dict)
                
                # Add source file name
                if "Source File" not in df.columns:
                    df = df.with_columns(pl.lit(os.path.basename(f)).alias("Source File"))
                
                # Add DDO Code and DDO Name columns
                if "DDO Code" not in df.columns:
                    df = df.with_columns(pl.lit(ddo_code).alias("DDO Code"))
                else:
                    df = df.with_columns(pl.col("DDO Code").fill_null(ddo_code).cast(pl.String))
                    
                if "DDO Name" not in df.columns:
                    df = df.with_columns(pl.lit(ddo_name).alias("DDO Name"))
                else:
                    df = df.with_columns(pl.col("DDO Name").fill_null(ddo_name).cast(pl.String))
                
                # Make sure key columns are string to prevent dtype mismatches during concat
                str_cols = ["Account Number", "Party Code", "Voucher No.", "Major Head", "Try Code", "Try Name", "Raw Voucher Number", "UTR No.", "DDO Code", "DDO Name", "Source File", "Payment Mode", "Bill Type", "Bill Ref No", "Voucher Date"]
                for c in str_cols:
                    if c in df.columns:
                        df = df.with_columns(pl.col(c).cast(pl.String))
                
                if "Voucher Date" in df.columns:
                    df = df.with_columns(
                        pl.col("Voucher Date")
                        .fill_null("")
                        .cast(pl.String)
                        .map_elements(clean_voucher_date, return_dtype=pl.String)
                    )
                
                # Ensure Amount is Float
                if "Amount" in df.columns:
                    df = df.with_columns(pl.col("Amount").cast(pl.Float64, strict=False))
                    
                dfs.append(df)
                parsed_count += 1
                progress_callback(20 + int((idx+1)/len(files) * 40))
            except Exception as e:
                log_callback(f"[WARNING] Failed to parse {os.path.basename(f)}: {e}")

        if not dfs:
            raise ValueError("Failed to parse any of the specified POL files.")
            
        log_callback(f"[INFO] Successfully parsed {parsed_count} files. Concatenating...")
        
        # 3. Concatenate dataframes
        # Align columns by filling missing ones with null
        all_cols = set()
        for df in dfs:
            all_cols.update(df.columns)
            
        aligned_dfs = []
        for df in dfs:
            aligned = df
            for c in all_cols:
                if c not in aligned.columns:
                    if c == "Amount":
                        aligned = aligned.with_columns(pl.lit(None).cast(pl.Float64).alias(c))
                    else:
                        aligned = aligned.with_columns(pl.lit(None).cast(pl.String).alias(c))
            aligned = aligned.select(sorted(list(all_cols)))
            aligned_dfs.append(aligned)
            
        merged_df = pl.concat(aligned_dfs)
        log_callback(f"[INFO] Concatenated size: {merged_df.height:,} rows.")
        progress_callback(70)

        # 3.2 Filter out "Total" summary rows and empty Voucher numbers
        pre_filter = merged_df.height
        if "Sr No" in merged_df.columns:
            merged_df = merged_df.filter(
                (pl.col("Sr No").fill_null("").str.to_lowercase().str.strip_chars() != "total") &
                (pl.col("Sr No").fill_null("").str.to_lowercase().str.strip_chars() != "grand total")
            )
        if "Raw Voucher Number" in merged_df.columns:
            merged_df = merged_df.filter(
                pl.col("Raw Voucher Number").is_not_null() & 
                (pl.col("Raw Voucher Number").str.strip_chars() != "")
            )
        removed_rows = pre_filter - merged_df.height
        if removed_rows > 0:
            log_callback(f"[INFO] Filtered out {removed_rows:,} summary/header/empty rows.")

        # 3.5 Extract and normalize voucher columns (Voucher No., Major Head, Try Code, Try Name, Month, Year)
        log_callback("[INFO] Normalizing voucher columns (Voucher No., Major Head, Try Code, Try Name, Month, Year)...")
        if "Raw Voucher Number" in merged_df.columns:
            split_expr = pl.col("Raw Voucher Number").str.split("/")
            merged_df = merged_df.with_columns([
                split_expr.list.get(0).alias("Try Code"),
                split_expr.list.get(1).alias("Major Head"),
                split_expr.list.get(-1).alias("Voucher No.")
            ])
            
            # Map Try Code to Try Name (3-letter character code) and normalize Try Code to 3-digit numeric string
            merged_df = merged_df.with_columns([
                pl.col("Try Code").map_elements(lambda x: map_treasury_code(x), return_dtype=pl.String).alias("Try Name"),
                pl.col("Try Code").map_elements(lambda x: get_numeric_try_code(x), return_dtype=pl.String).alias("Try Code")
            ])
            
        if "Voucher No." in merged_df.columns:
            merged_df = merged_df.with_columns([
                pl.col("Voucher No.").str.replace(r"\.0$", "")
            ])
            
        # Extract Month and Year from Source File name
        if "Source File" in merged_df.columns:
            merged_df = merged_df.with_columns([
                pl.col("Source File").str.extract(r"(?:^|[^0-9])(0[1-9]|1[0-2])[-_\s](\d{4})", 1).alias("Month"),
                pl.col("Source File").str.extract(r"(?:^|[^0-9])(0[1-9]|1[0-2])[-_\s](\d{4})", 2).alias("Year")
            ])

        # 4. Multi-treasury check
        if not allow_multi_treasury and "Try Code" in merged_df.columns:
            tries = merged_df.select("Try Code").drop_nulls().unique().to_series().to_list()
            norm_tries = set()
            for t in tries:
                t_norm = map_treasury_code(t)
                if t_norm:
                    norm_tries.add(t_norm)
            if len(norm_tries) > 1:
                log_callback(f"[WARNING] Multiple treasuries detected: {list(norm_tries)}")
                
        # 5. Deduplication
        initial_count = merged_df.height
        
        # Exact duplicate removal
        merged_df = merged_df.unique()
        exact_dups = initial_count - merged_df.height
        log_callback(f"[INFO] Removed {exact_dups:,} exact duplicate rows.")
        
        # Logical duplicate removal
        if remove_dups:
            subset_cols = []
            for c in ["Account Number", "Voucher No.", "Amount", "Party Code"]:
                if c in merged_df.columns:
                    subset_cols.append(c)
            if subset_cols:
                pre_logical = merged_df.height
                # Create a temporary dataframe with cleaned and normalized keys for deduplication
                temp_df = merged_df.clone()
                
                # Normalize subset_cols in temp_df
                if "Account Number" in temp_df.columns:
                    temp_df = temp_df.with_columns(
                        pl.col("Account Number")
                        .fill_null("0")
                        .cast(pl.String)
                        .str.replace(r"\.0$", "")
                        .str.strip_chars()
                    )
                if "Voucher No." in temp_df.columns:
                    temp_df = temp_df.with_columns(
                        pl.col("Voucher No.")
                        .fill_null("0")
                        .cast(pl.String)
                        .str.replace(r"\.0$", "")
                        .str.strip_chars()
                        .str.replace(r"^0+", "")
                    )
                if "Amount" in temp_df.columns:
                    temp_df = temp_df.with_columns(
                        pl.col("Amount")
                        .fill_null("0")
                        .cast(pl.String)
                        .str.replace(r"\.0$", "")
                        .str.strip_chars()
                    )
                if "Party Code" in temp_df.columns:
                    temp_df = temp_df.with_columns(
                        pl.col("Party Code")
                        .fill_null("0")
                        .cast(pl.String)
                        .str.replace(r"\.0$", "")
                        .str.strip_chars()
                    )
                
                # Get indices of unique rows in temp_df
                unique_indices = temp_df.with_row_index().unique(subset=subset_cols, keep="first").select("index").to_series().to_list()
                
                # Filter merged_df using the unique indices
                merged_df = merged_df.with_row_index().filter(pl.col("index").is_in(unique_indices)).drop("index")
                logical_dups = pre_logical - merged_df.height
                log_callback(f"[INFO] Removed {logical_dups:,} logical duplicate rows based on key columns: {subset_cols}.")
                
        progress_callback(85)
        
        # 6. Normalize Try Code / Try Name if present
        if "Try Code" in merged_df.columns:
            merged_df = merged_df.with_columns([
                pl.col("Try Code").map_elements(lambda x: get_numeric_try_code(x), return_dtype=pl.String).alias("Try Code")
            ])
            
        # 7. Save Output
        log_callback(f"[INFO] Saving merged dataset to: {out_path}")
        if "Amount" in merged_df.columns:
            merged_df = merged_df.with_columns(pl.col("Amount").cast(pl.Float64, strict=False))
            
        if out_path.lower().endswith(('.xlsx', '.xls')):
            merged_pd = merged_df.to_pandas()
            merged_pd.to_excel(out_path, index=False)
        else:
            # If CSV, format key identifier columns as Excel-compatible text formulas
            # to prevent Excel from auto-converting to scientific notation or truncating leading zeros
            csv_df = merged_df.clone()
            text_cols = ["Account Number", "Party Code", "DDO Code", "Try Code", "Voucher No.", "UTR No."]
            for col in text_cols:
                if col in csv_df.columns:
                    csv_df = csv_df.with_columns(
                        pl.when(pl.col(col).is_not_null() & (pl.col(col).str.strip_chars() != ""))
                        .then(pl.lit("=\"") + pl.col(col).cast(pl.String) + pl.lit("\""))
                        .otherwise(pl.col(col))
                        .alias(col)
                    )
            csv_df.write_csv(out_path)
            
        progress_callback(100)
        elapsed = time.time() - start_time
        log_callback(f"[SUCCESS] POL Merger finished successfully in {elapsed:.2f} seconds.")
        log_callback(f"[SUCCESS] Saved {merged_df.height:,} rows to: {os.path.basename(out_path)}")
        
    except Exception as e:
        log_callback(f"[ERROR] Merger aborted: {e}")
        progress_callback(-1)

# GUI Implementation
class LinkerGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("IFMS POL & VLC Data Studio (Polars Mode)")
        self.root.geometry("780x680")
        self.root.configure(bg=BG_MAIN)
        self.root.resizable(True, True)
        
        self.log_queue = queue.Queue()
        self.is_running = False
        
        # Load fonts safely
        self.title_font = font.Font(family="Segoe UI", size=14, weight="bold")
        self.label_font = font.Font(family="Segoe UI", size=10, weight="bold")
        self.btn_font = font.Font(family="Segoe UI", size=10, weight="bold")
        self.term_font = font.Font(family="Consolas", size=9)
        
        # ttk style setup for premium dark look
        self.style = ttk.Style()
        self.style.theme_use("default")
        self.style.configure("TNotebook", background=BG_MAIN, borderwidth=0)
        self.style.configure("TNotebook.Tab", background=BG_PANEL, foreground=TEXT_MUTED, borderwidth=1, bordercolor=BORDER_COLOR, padding=[15, 6], font=("Segoe UI", 9, "bold"))
        self.style.map("TNotebook.Tab", background=[("selected", BG_MAIN)], foreground=[("selected", ACCENT)])
        self.style.configure("TFrame", background=BG_MAIN, borderwidth=0)
        self.style.configure("TCheckbutton", background=BG_MAIN, foreground=TEXT_MAIN, font=("Segoe UI", 9, "bold"))
        
        self._build_ui()
        self._poll_logs()

    def _build_ui(self):
        # 1. Title bar panel
        title_frame = tk.Frame(self.root, bg=BG_PANEL, height=70, bd=0)
        title_frame.pack(fill="x", side="top")
        title_frame.pack_propagate(False)
        
        title_label = tk.Label(
            title_frame,
            text="IFMS POL & VLC DATA STUDIO",
            fg=ACCENT,
            bg=BG_PANEL,
            font=self.title_font
        )
        title_label.pack(anchor="w", padx=20, pady=(12, 2))
        
        subtitle_label = tk.Label(
            title_frame,
            text="High Performance Data Merger & Linker via Polars",
            fg=TEXT_MUTED,
            bg=BG_PANEL,
            font=("Segoe UI", 9, "italic")
        )
        subtitle_label.pack(anchor="w", padx=20, pady=(0, 10))

        # 2. Tab Notebook
        notebook = ttk.Notebook(self.root)
        notebook.pack(fill="both", expand=True, padx=20, pady=(15, 5))
        
        tab_merge = ttk.Frame(notebook)
        tab_link = ttk.Frame(notebook)
        
        notebook.add(tab_merge, text=" 1. MERGE RAW POL FILES ")
        notebook.add(tab_link, text=" 2. LINK POL & VLC DATA ")
        
        # ----------------------------------------------------
        # Tab 1: Merge Raw POL Files
        # ----------------------------------------------------
        self.merge_in_var = tk.StringVar()
        self.merge_out_var = tk.StringVar()
        self.remove_dups_var = tk.BooleanVar(value=True)
        self.allow_multi_var = tk.BooleanVar(value=False)
        
        # Grid inside tab_merge
        tab_merge.columnconfigure(0, weight=1)
        tab_merge.columnconfigure(1, weight=0)
        
        # Row 0: Input Directory / Files
        lbl_in = tk.Label(tab_merge, text="1. Select Input Folder (containing raw Excel/CSV files)", fg=TEXT_MAIN, bg=BG_MAIN, font=self.label_font)
        lbl_in.grid(row=0, column=0, sticky="w", pady=(15, 2))
        
        entry_in = tk.Entry(tab_merge, textvariable=self.merge_in_var, fg=TEXT_MAIN, bg=BG_PANEL, bd=1, relief="solid", highlightthickness=0, insertbackground=TEXT_MAIN)
        entry_in.grid(row=1, column=0, sticky="ew", padx=(0, 240), ipady=6)
        
        def browse_merge_in_dir():
            path = filedialog.askdirectory()
            if path:
                self.merge_in_var.set(path)
                
        def browse_merge_in_files():
            paths = filedialog.askopenfilenames(filetypes=[("Raw POL Data", "*.csv *.xlsx *.xls"), ("All Files", "*.*")])
            if paths:
                self.merge_in_var.set(";".join(paths))
                
        btn_in_dir = tk.Button(
            tab_merge, text="Browse Folder", command=browse_merge_in_dir,
            fg=TEXT_MAIN, bg=BORDER_COLOR, activeforeground=TEXT_MAIN, activebackground=BG_PANEL,
            relief="flat", bd=0, font=self.btn_font, cursor="hand2"
        )
        btn_in_dir.grid(row=1, column=1, sticky="ne", ipady=4, ipadx=6, padx=(0, 100))
        
        btn_in_files = tk.Button(
            tab_merge, text="Browse Files", command=browse_merge_in_files,
            fg=TEXT_MAIN, bg=BORDER_COLOR, activeforeground=TEXT_MAIN, activebackground=BG_PANEL,
            relief="flat", bd=0, font=self.btn_font, cursor="hand2"
        )
        btn_in_files.grid(row=1, column=1, sticky="ne", ipady=4, ipadx=8)
        
        # Row 2: Output File
        lbl_out = tk.Label(tab_merge, text="2. Save Merged POL File As (CSV or Excel)", fg=TEXT_MAIN, bg=BG_MAIN, font=self.label_font)
        lbl_out.grid(row=2, column=0, sticky="w", pady=(15, 2))
        
        entry_out = tk.Entry(tab_merge, textvariable=self.merge_out_var, fg=TEXT_MAIN, bg=BG_PANEL, bd=1, relief="solid", highlightthickness=0, insertbackground=TEXT_MAIN)
        entry_out.grid(row=3, column=0, sticky="ew", padx=(0, 100), ipady=6)
        
        def browse_merge_out():
            path = filedialog.asksaveasfilename(
                defaultextension=".csv",
                filetypes=[("CSV File", "*.csv"), ("Excel File", "*.xlsx")],
                initialfile="IFMS_Merged_PoL.csv"
            )
            if path:
                self.merge_out_var.set(path)
                
        btn_out = tk.Button(
            tab_merge, text="Save As", command=browse_merge_out,
            fg=TEXT_MAIN, bg=BORDER_COLOR, activeforeground=TEXT_MAIN, activebackground=BG_PANEL,
            relief="flat", bd=0, font=self.btn_font, cursor="hand2"
        )
        btn_out.grid(row=3, column=1, sticky="ne", ipady=4, ipadx=14)
        
        # Row 4: Checkboxes
        chk_frame = tk.Frame(tab_merge, bg=BG_MAIN)
        chk_frame.grid(row=4, column=0, columnspan=2, sticky="w", pady=15)
        
        chk_dups = tk.Checkbutton(
            chk_frame, text="Remove logical duplicates (same Account, Voucher, Amount, Party Code)",
            variable=self.remove_dups_var, fg=TEXT_MAIN, bg=BG_MAIN, selectcolor=BG_PANEL,
            activebackground=BG_MAIN, activeforeground=TEXT_MAIN, font=("Segoe UI", 9, "bold"), cursor="hand2"
        )
        chk_dups.pack(anchor="w", pady=2)
        
        chk_multi = tk.Checkbutton(
            chk_frame, text="Allow merging files from different treasuries",
            variable=self.allow_multi_var, fg=TEXT_MAIN, bg=BG_MAIN, selectcolor=BG_PANEL,
            activebackground=BG_MAIN, activeforeground=TEXT_MAIN, font=("Segoe UI", 9, "bold"), cursor="hand2"
        )
        chk_multi.pack(anchor="w", pady=2)
        
        # Row 5: Action Button
        btn_merge = tk.Button(
            tab_merge, text="Merge Raw POL Files Now", command=self.start_merging,
            fg=BG_MAIN, bg=ACCENT, activeforeground=BG_MAIN, activebackground=ACCENT_HOVER,
            relief="flat", bd=0, font=self.btn_font, cursor="hand2", padx=20, pady=8
        )
        btn_merge.grid(row=5, column=0, columnspan=2, sticky="e", pady=(10, 10))
        self.btn_merge = btn_merge

        # ----------------------------------------------------
        # Tab 2: Link POL & VLC Data
        # ----------------------------------------------------
        # Grid inside tab_link
        tab_link.columnconfigure(0, weight=1)
        tab_link.columnconfigure(1, weight=0)
        
        # Row 0: Merged POL File
        self.pol_var = tk.StringVar()
        self.vlc_var = tk.StringVar()
        self.out_var = tk.StringVar()

        lbl_pol = tk.Label(tab_link, text="1. Merged POL File (CSV or Excel)", fg=TEXT_MAIN, bg=BG_MAIN, font=self.label_font)
        lbl_pol.grid(row=0, column=0, sticky="w", pady=(15, 2))
        
        entry_pol = tk.Entry(tab_link, textvariable=self.pol_var, fg=TEXT_MAIN, bg=BG_PANEL, bd=1, relief="solid", highlightthickness=0, insertbackground=TEXT_MAIN)
        entry_pol.grid(row=1, column=0, sticky="ew", padx=(0, 100), ipady=6)
        
        def browse_pol():
            path = filedialog.askopenfilename(filetypes=[("POL Data", "*.csv *.xlsx *.xls"), ("All Files", "*.*")])
            if path:
                self.pol_var.set(path)
                
        btn_pol = tk.Button(
            tab_link, text="Browse File", command=browse_pol,
            fg=TEXT_MAIN, bg=BORDER_COLOR, activeforeground=TEXT_MAIN, activebackground=BG_PANEL,
            relief="flat", bd=0, font=self.btn_font, cursor="hand2"
        )
        btn_pol.grid(row=1, column=1, sticky="ne", ipady=4, ipadx=10)
        
        # Row 2: VLC Data File
        lbl_vlc = tk.Label(tab_link, text="2. VLC Data File (CSV)", fg=TEXT_MAIN, bg=BG_MAIN, font=self.label_font)
        lbl_vlc.grid(row=2, column=0, sticky="w", pady=(15, 2))
        
        entry_vlc = tk.Entry(tab_link, textvariable=self.vlc_var, fg=TEXT_MAIN, bg=BG_PANEL, bd=1, relief="solid", highlightthickness=0, insertbackground=TEXT_MAIN)
        entry_vlc.grid(row=3, column=0, sticky="ew", padx=(0, 100), ipady=6)
        
        def browse_vlc():
            path = filedialog.askopenfilename(filetypes=[("VLC CSV Data", "*.csv"), ("All Files", "*.*")])
            if path:
                self.vlc_var.set(path)
                
        btn_vlc = tk.Button(
            tab_link, text="Browse File", command=browse_vlc,
            fg=TEXT_MAIN, bg=BORDER_COLOR, activeforeground=TEXT_MAIN, activebackground=BG_PANEL,
            relief="flat", bd=0, font=self.btn_font, cursor="hand2"
        )
        btn_vlc.grid(row=3, column=1, sticky="ne", ipady=4, ipadx=10)
        
        # Row 4: Output File
        lbl_link_out = tk.Label(tab_link, text="3. Output Linked File (CSV or Excel)", fg=TEXT_MAIN, bg=BG_MAIN, font=self.label_font)
        lbl_link_out.grid(row=4, column=0, sticky="w", pady=(15, 2))
        
        entry_link_out = tk.Entry(tab_link, textvariable=self.out_var, fg=TEXT_MAIN, bg=BG_PANEL, bd=1, relief="solid", highlightthickness=0, insertbackground=TEXT_MAIN)
        entry_link_out.grid(row=5, column=0, sticky="ew", padx=(0, 100), ipady=6)
        
        def browse_link_out():
            path = filedialog.asksaveasfilename(
                defaultextension=".csv",
                filetypes=[("CSV File", "*.csv"), ("Excel File", "*.xlsx")],
                initialfile="IFMS_Merged_PoL_VLC_Linked.csv"
            )
            if path:
                self.out_var.set(path)
                
        btn_link_out = tk.Button(
            tab_link, text="Save As", command=browse_link_out,
            fg=TEXT_MAIN, bg=BORDER_COLOR, activeforeground=TEXT_MAIN, activebackground=BG_PANEL,
            relief="flat", bd=0, font=self.btn_font, cursor="hand2"
        )
        btn_link_out.grid(row=5, column=1, sticky="ne", ipady=4, ipadx=14)
        
        # Row 6: Action Buttons
        link_btn_frame = tk.Frame(tab_link, bg=BG_MAIN)
        link_btn_frame.grid(row=6, column=0, columnspan=2, sticky="ew", pady=(20, 10))
        link_btn_frame.columnconfigure(0, weight=1)
        
        self.btn_run = tk.Button(
            link_btn_frame, text="Link Datasets Now", command=self.start_linking,
            fg=BG_MAIN, bg=ACCENT, activeforeground=BG_MAIN, activebackground=ACCENT_HOVER,
            relief="flat", bd=0, font=self.btn_font, cursor="hand2", padx=18, pady=6
        )
        self.btn_run.pack(side="right", padx=(10, 0))
        
        self.btn_split = tk.Button(
            link_btn_frame, text="Extract Trimmed VLC CSV", command=self.start_splitting,
            fg=TEXT_MAIN, bg=BORDER_COLOR, activeforeground=TEXT_MAIN, activebackground=BG_PANEL,
            relief="flat", bd=0, font=self.btn_font, cursor="hand2", padx=15, pady=6
        )
        self.btn_split.pack(side="right")

        # ----------------------------------------------------
        # Shared bottom panel: Progress Bar and Console
        # ----------------------------------------------------
        bottom_frame = tk.Frame(self.root, bg=BG_MAIN)
        bottom_frame.pack(fill="both", expand=True, padx=20, pady=(5, 20))
        bottom_frame.columnconfigure(0, weight=1)
        
        # Progress canvas
        self.p_canvas = tk.Canvas(bottom_frame, height=12, bg=BG_PANEL, bd=0, highlightthickness=0)
        self.p_canvas.grid(row=0, column=0, sticky="ew", pady=(5, 10))
        self.p_rect = self.p_canvas.create_rectangle(0, 0, 0, 12, fill=ACCENT, outline="")
        
        # Terminal header
        log_lbl = tk.Label(bottom_frame, text="Execution Terminal Output", fg=TEXT_MUTED, bg=BG_MAIN, font=("Segoe UI", 9, "bold"))
        log_lbl.grid(row=1, column=0, sticky="w", pady=(0, 2))
        
        # Terminal Text
        self.term = tk.Text(
            bottom_frame, fg="#22c55e", bg=BG_TERMINAL, bd=1, relief="solid",
            highlightthickness=0, font=self.term_font, wrap="word", state="disabled"
        )
        self.term.grid(row=2, column=0, sticky="nsew")
        bottom_frame.rowconfigure(2, weight=1)

    def write_log(self, msg):
        self.log_queue.put(msg)

    def update_progress(self, pct):
        self.root.after(0, self._set_progress_bar, pct)

    def _set_progress_bar(self, pct):
        w = self.p_canvas.winfo_width()
        if w <= 1:
            w = 700  # Fallback
        if pct < 0:
            self.p_canvas.coords(self.p_rect, 0, 0, 0, 12)
        else:
            val = int((pct / 100.0) * w)
            self.p_canvas.coords(self.p_rect, 0, 0, val, 12)

    def _poll_logs(self):
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self.term.configure(state="normal")
                self.term.insert("end", str(msg) + "\n")
                self.term.see("end")
                self.term.configure(state="disabled")
        except queue.Empty:
            pass
        self.root.after(100, self._poll_logs)

    def start_merging(self):
        if self.is_running:
            return
            
        in_path = self.merge_in_var.get().strip()
        out_path = self.merge_out_var.get().strip()
        
        if not in_path or not out_path:
            messagebox.showerror("Missing Paths", "Please specify input folder/files and output file paths before executing.")
            return
            
        if ";" in in_path:
            files = [f.strip() for f in in_path.split(";") if f.strip()]
            for f in files:
                if not os.path.exists(f):
                    messagebox.showerror("Error", f"Input file does not exist:\n{f}")
                    return
            input_arg = files
        else:
            if not os.path.exists(in_path):
                messagebox.showerror("Error", f"Input folder/file does not exist:\n{in_path}")
                return
            input_arg = in_path
            
        self.is_running = True
        self.btn_run.configure(state="disabled", bg=BORDER_COLOR)
        self.btn_split.configure(state="disabled", bg=BORDER_COLOR)
        self.btn_merge.configure(state="disabled", bg=BORDER_COLOR, text="Merging...")
        
        self.term.configure(state="normal")
        self.term.delete("1.0", "end")
        self.term.configure(state="disabled")
        
        self.update_progress(0)
        
        def thread_target():
            run_pol_merger(
                input_arg, out_path,
                remove_dups=self.remove_dups_var.get(),
                allow_multi_treasury=self.allow_multi_var.get(),
                log_callback=self.write_log,
                progress_callback=self.update_progress
            )
            self.root.after(0, self._on_merge_complete)
            
        threading.Thread(target=thread_target, daemon=True).start()

    def _on_merge_complete(self):
        self.is_running = False
        self.btn_run.configure(state="normal", bg=ACCENT)
        self.btn_split.configure(state="normal", bg=BORDER_COLOR)
        self.btn_merge.configure(state="normal", bg=ACCENT, text="Merge Raw POL Files Now")
        
        coords = self.p_canvas.coords(self.p_rect)
        w = self.p_canvas.winfo_width()
        if w <= 1:
            w = 700
        if coords and coords[2] >= w - 5:
            msg = "Raw POL files merged and deduplicated successfully!\n\nDo you want to open the output file now?"
            if messagebox.askyesno("Merging Complete", msg):
                try:
                    os.startfile(self.merge_out_var.get().strip())
                except Exception as e:
                    messagebox.showerror("Error", f"Could not open file:\n{e}")

    def start_linking(self):
        if self.is_running:
            return
            
        pol = self.pol_var.get().strip()
        vlc = self.vlc_var.get().strip()
        out = self.out_var.get().strip()
        
        if not pol or not vlc or not out:
            messagebox.showerror("Missing Paths", "Please specify paths for POL, VLC, and Output files before executing.")
            return
            
        if not os.path.exists(pol):
            messagebox.showerror("Error", f"POL file does not exist:\n{pol}")
            return
            
        if not os.path.exists(vlc):
            messagebox.showerror("Error", f"VLC file does not exist:\n{vlc}")
            return
            
        self.is_running = True
        self.btn_run.configure(state="disabled", bg=BORDER_COLOR, text="Linking...")
        self.btn_split.configure(state="disabled", bg=BORDER_COLOR)
        self.btn_merge.configure(state="disabled", bg=BORDER_COLOR)
        
        self.term.configure(state="normal")
        self.term.delete("1.0", "end")
        self.term.configure(state="disabled")
        
        self.update_progress(0)
        
        def thread_target():
            run_linker_engine(
                pol, vlc, out,
                log_callback=self.write_log,
                progress_callback=self.update_progress
            )
            self.root.after(0, self._on_complete)
            
        threading.Thread(target=thread_target, daemon=True).start()

    def start_splitting(self):
        if self.is_running:
            return
            
        pol = self.pol_var.get().strip()
        vlc = self.vlc_var.get().strip()
        
        if not pol or not vlc:
            messagebox.showerror("Missing Paths", "Please specify paths for POL and VLC files before executing.")
            return
            
        if not os.path.exists(pol):
            messagebox.showerror("Error", f"POL file does not exist:\n{pol}")
            return
            
        if not os.path.exists(vlc):
            messagebox.showerror("Error", f"VLC file does not exist:\n{vlc}")
            return

        # Default save path for trimmed VLC
        vlc_dir = os.path.dirname(vlc)
        default_out_name = "COMPAY_2025_26_Trimmed.csv"
        out = filedialog.asksaveasfilename(
            initialdir=vlc_dir,
            initialfile=default_out_name,
            defaultextension=".csv",
            filetypes=[("CSV File", "*.csv")]
        )
        if not out:
            return
            
        self.split_out = out
        self.is_running = True
        self.btn_run.configure(state="disabled", bg=BORDER_COLOR)
        self.btn_split.configure(state="disabled", bg=BORDER_COLOR, text="Processing...")
        self.btn_merge.configure(state="disabled", bg=BORDER_COLOR)
        
        self.term.configure(state="normal")
        self.term.delete("1.0", "end")
        self.term.configure(state="disabled")
        
        self.update_progress(0)
        
        def thread_target():
            run_vlc_splitter(
                pol, vlc, out,
                log_callback=self.write_log,
                progress_callback=self.update_progress
            )
            self.root.after(0, self._on_split_complete)
            
        threading.Thread(target=thread_target, daemon=True).start()

    def _on_complete(self):
        self.is_running = False
        self.btn_run.configure(state="normal", bg=ACCENT, text="Link Datasets Now")
        self.btn_split.configure(state="normal", bg=BORDER_COLOR)
        self.btn_merge.configure(state="normal", bg=ACCENT)
        
        coords = self.p_canvas.coords(self.p_rect)
        w = self.p_canvas.winfo_width()
        if w <= 1:
            w = 700
        if coords and coords[2] >= w - 5:
            msg = "POL and VLC data linked successfully using Polars!\n\nDo you want to open the output file now?"
            if messagebox.askyesno("Linking Complete", msg):
                try:
                    os.startfile(self.out_var.get().strip())
                except Exception as e:
                    messagebox.showerror("Error", f"Could not open file:\n{e}")

    def _on_split_complete(self):
        self.is_running = False
        self.btn_run.configure(state="normal", bg=ACCENT)
        self.btn_split.configure(state="normal", bg=BORDER_COLOR, text="Extract Trimmed VLC CSV")
        self.btn_merge.configure(state="normal", bg=ACCENT)
        
        coords = self.p_canvas.coords(self.p_rect)
        w = self.p_canvas.winfo_width()
        if w <= 1:
            w = 700
        if coords and coords[2] >= w - 5:
            msg = "Trimmed VLC CSV file extracted successfully!\n\nDo you want to open the output file now?"
            if messagebox.askyesno("Extraction Complete", msg):
                try:
                    os.startfile(self.split_out)
                except Exception as e:
                    messagebox.showerror("Error", f"Could not open file:\n{e}")

# CLI Entrypoint
def main():
    parser = argparse.ArgumentParser(description="IFMS POL & VLC Data Studio")
    parser.add_argument("--pol", help="Path to merged POL CSV/Excel file, or raw POL input folder/files (for --merge)")
    parser.add_argument("--vlc", help="Path to VLC CSV file")
    parser.add_argument("--out", help="Path to output linked CSV/Excel file, or output merged file (for --merge)")
    parser.add_argument("--split", action="store_true", help="Extract trimmed VLC CSV instead of linking")
    parser.add_argument("--merge", action="store_true", help="Merge raw POL files instead of linking")
    parser.add_argument("--remove-dups", action="store_true", default=True, help="Remove logical duplicates during merge")
    parser.add_argument("--allow-multi", action="store_true", default=False, help="Allow multi-treasury files during merge")
    parser.add_argument("--cli", action="store_true", help="Force command-line mode without GUI")
    
    args = parser.parse_args()
    
    # If explicit CLI arguments or --cli is set, run in console mode
    if args.cli or (args.pol and args.out and (args.merge or args.vlc)):
        if not args.pol or not args.out:
            print("[ERROR] CLI mode requires --pol and --out parameters.")
            sys.exit(1)
            
        print("="*60)
        if args.merge:
            print("IFMS POL & VLC Data Studio - Raw POL Merging CLI Mode")
        elif args.split:
            print("IFMS POL & VLC Data Studio - VLC Splitting CLI Mode")
        else:
            print("IFMS POL & VLC Data Studio - Linking CLI Mode")
        print("="*60)
        
        def console_log(m):
            try:
                print(m)
            except UnicodeEncodeError:
                try:
                    encoding = sys.stdout.encoding or 'ascii'
                    print(str(m).encode(encoding, errors='replace').decode(encoding))
                except Exception:
                    pass
        def console_progress(pct):
            if pct > 0:
                print(f"Progress: {pct}%")
                
        if args.merge:
            run_pol_merger(
                args.pol, args.out,
                remove_dups=args.remove_dups,
                allow_multi_treasury=args.allow_multi,
                log_callback=console_log,
                progress_callback=console_progress
            )
        elif args.split:
            if not args.vlc:
                print("[ERROR] VLC Splitting requires --vlc parameter.")
                sys.exit(1)
            run_vlc_splitter(
                args.pol, args.vlc, args.out,
                log_callback=console_log,
                progress_callback=console_progress
            )
        else:
            if not args.vlc:
                print("[ERROR] Linking requires --vlc parameter.")
                sys.exit(1)
            run_linker_engine(
                args.pol, args.vlc, args.out,
                log_callback=console_log,
                progress_callback=console_progress
            )
    else:
        # Launch beautiful GUI
        root = tk.Tk()
        app = LinkerGUI(root)
        root.mainloop()

if __name__ == "__main__":
    main()
