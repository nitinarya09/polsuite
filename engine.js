// ═══════════════════════════════════════════════════════════════════════
// IFMS POL AUDIT SUITE — ENGINE v2.4
// Build Date : 2026-07-06
//
// CHANGES FROM v2.3 (v2.4 Triage & Convergence)
//  NEW CHECKS:
//   T-1  run_triage_top_accounts   — Multi-check convergence, top-100 risky accounts
//   T-2  run_voucher_clustering    — Group flagged entries by voucher number
//   T-3  run_ghost_employee_composite — Composite ghost employee score (6 signals)
//   T-4  run_vendor_fraud_composite   — Composite vendor fraud score (6 signals)
//   T-5  run_audit_narratives      — Auto-generated audit observation paragraphs
//
// CHANGES FROM v2.3.1 (Wave 2 Completion)
//  D-6  UTR aliases normalized to r.utrNo via normalizeRecords() at dispatch entry
//       All checks receive records with r.utrNo guaranteed (no 5-alias chain)
//  D-7  Why_Flagged = short 1-line summary; AUDIT_ISSUE = full detail string
//       _shortReason() helper extracts summary automatically from any reason string
//
// CHANGES FROM v2.3 (Wave 2 Patches)
//  A-9  Rapid payments: sliding 30-day window replaces misleading average-gap
//  B-13 run_flag_dow_concentration — Day-of-week batch manipulation signal
//  C-7  Vendor concentration excludes micro-transactions (vendor_min_txn_amount)
//  C-8  Approval limits thresholds + band % now configurable via settings
//  C-10 Round amounts: raised risk scores; new AT_THRESHOLD tier (score=65)
//  D-8  Legacy acct_wise_total (run_flag_3) removed from dispatch table
//
// CHANGES FROM v2.2.1
//  BUG FIXES:
//   A-1  ddosList.size → .length (cross_ddo — severity calc was always wrong)
//   A-2  Grouping threshold hardcoded to 2 in same_account_diff_party_paybill
//   A-4  intVal() → parseInt() in ta_bills (year was silently NaN)
//   A-6  DDO_Code/DDO_Name double field-read fixed in formatOutputRow
//   A-7  FVC label typo ₹5,0,000 → ₹5,00,000
//   A-8  r.ddoName || r.ddoName → r.ddoName || r.DDO_Name
//   A-12 GPF trigger changed to same-month; expanded keywords (GPF, DPF, PROVIDENT FUND)
//   A-14 DCRG keywords expanded to include GRATUITY, DCR, DEATH CUM RETIREMENT
//   A-15 Split billing window made configurable (split_billing_window_days, default=3)
//
//  LOGIC IMPROVEMENTS:
//   C-5  Benford's Law excludes PAY BILL rows
//   C-6  Round Amounts excludes PAY BILL rows
//   C-9  Same-Day check adds minimum amount filter (same_day_min_amount, default=5000)
//   A-10 Flag_6c date window default widened from 14 → 90 days
//   A-11 Flag_8b duplicate scoped to financial year (not all-time)
//   A-13 TA bills grouped by DDO+account+year (prevents transfer false-flags)
//   D-1  O(n³) interleaving replaced with O(n) in both multi-DDO paybill checks
//   D-9  Added MP state-specific holidays (Nov 1, Dec 3, May 1, Nov 14)
//   D-10 Excessive freq year detection: prefers r.Year field over date regex
//
//  NEW CHECKS:
//   B-8  run_flag_march_rush_new_account — Year-end new account injection
//   B-9  run_flag_annual_vendor_cap      — Vendor cumulative cap per DDO per FY
//   B-10 run_flag_suspicious_names       — Dummy/test beneficiary name detection
//   B-11 run_flag_salary_jump            — Month-on-month salary jump >30%
//   B-12 run_flag_ddo_march_rush         — DDO year-end budget exhaustion
// ═══════════════════════════════════════════════════════════════════════
(function() {
function getSetting(key, defaultValue) {
          if (typeof self !== 'undefined' && self.auditSettings && self.auditSettings[key] !== undefined) {
            return self.auditSettings[key];
          }
          if (typeof window !== 'undefined' && window.auditSettings && window.auditSettings[key] !== undefined) {
            return window.auditSettings[key];
          }
          return defaultValue;
        }

        // ── D-6 v2.3.2: Normalize all UTR field aliases to r.utrNo ─────────
        // The React UI layer may produce any of: utrNumber, UTR_Number,
        // UTRNumber, utrNo, utr. After normalizeRecords(), all checks can
        // safely read r.utrNo without the 5-alias fallback chain.
        function normalizeRecords(records) {
          records.forEach(r => {
            if (!r.utrNo) {
              r.utrNo = r.utrNumber || r.UTR_Number || r.UTRNumber || r.utr || "";
            }
          });
          return records;
        }

        // Helper to construct a FileList from an array of File objects
        function createFileList(files) {
          const dt = new DataTransfer();
          for (const file of files) {
            dt.items.add(file);
          }
          return dt.files;
        }

        // Filters out raw files if there is a merged file in the same directory (based on webkitRelativePath or same batch)
        function filterFiles(originalFileList) {
          if (!originalFileList || originalFileList.length === 0) {
            return originalFileList;
          }
          const filesArray = Array.from(originalFileList);

          // Group files by parent directory path
          const groups = {};
          for (const file of filesArray) {
            let parent = "";
            const path = file.webkitRelativePath || "";
            if (path) {
              const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
              if (lastSlash !== -1) {
                parent = path.substring(0, lastSlash);
              }
            }
            if (!groups[parent]) {
              groups[parent] = [];
            }
            groups[parent].push(file);
          }

          // In each group, if a file has "merged" in its name, keep only files with "merged" in their name
          const filteredList = [];
          for (const parent in groups) {
            const groupFiles = groups[parent];
            const mergedFiles = groupFiles.filter(f => f.name.toLowerCase().includes("merged"));
            if (mergedFiles.length > 0) {
              filteredList.push(...mergedFiles);
            } else {
              filteredList.push(...groupFiles);
            }
          }

          // If no files were filtered out, return the original FileList to avoid copying
          if (filteredList.length === filesArray.length) {
            return originalFileList;
          }

          return createFileList(filteredList);
        }

        // Intercept HTMLInputElement.prototype.files
        try {
          const originalFilesGetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').get;
          Object.defineProperty(HTMLInputElement.prototype, 'files', {
            get: function() {
              const rawFiles = originalFilesGetter.call(this);
              return filterFiles(rawFiles);
            },
            configurable: true
          });
        } catch (e) {
          console.error("Failed to override HTMLInputElement.prototype.files getter:", e);
        }

        // Intercept DataTransfer.prototype.files (for drag and drop)
        try {
          const originalDataTransferFilesGetter = Object.getOwnPropertyDescriptor(DataTransfer.prototype, 'files').get;
          Object.defineProperty(DataTransfer.prototype, 'files', {
            get: function() {
              const rawFiles = originalDataTransferFilesGetter.call(this);
              return filterFiles(rawFiles);
            },
            configurable: true
          });
        } catch (e) {
          console.error("Failed to override DataTransfer.prototype.files getter:", e);
        }

        window.parseDDMMYYYY = function(str) {
          if (!str) return null;
          if (str instanceof Date) return isNaN(str.getTime()) ? null : str;
          let s = String(str).trim();
          
          // If there is a space (e.g. separating date and time), take the date part
          const spaceIndex = s.indexOf(' ');
          if (spaceIndex !== -1) {
            s = s.substring(0, spaceIndex).trim();
          }
          
          // Match DD/MM/YYYY or DD-MM-YYYY
          const match = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
          if (match) {
            const d = parseInt(match[1], 10);
            const m = parseInt(match[2], 10) - 1;
            const y = parseInt(match[3], 10);
            const dt = new Date(y, m, d);
            if (!isNaN(dt.getTime())) return dt;
          }
          
          // Match YYYY-MM-DD
          const matchIso = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
          if (matchIso) {
            const y = parseInt(matchIso[1], 10);
            const m = parseInt(matchIso[2], 10) - 1;
            const d = parseInt(matchIso[3], 10);
            const dt = new Date(y, m, d);
            if (!isNaN(dt.getTime())) return dt;
          }
          
          const fallback = new Date(str);
          return isNaN(fallback.getTime()) ? null : fallback;
        };

        const urlParams = new URLSearchParams(window.location.search);
        const urlToken = urlParams.get('token');
        if (urlToken) {
          localStorage.setItem('ifmis_api_token', urlToken);
        }

        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
          if (typeof input === 'string' && input.startsWith('/api/')) {
            const base = window.location.protocol.startsWith('http') ? window.location.origin : (localStorage.getItem('ifmis_api_base') || 'http://127.0.0.1:5000');
            const token = localStorage.getItem('ifmis_api_token');
            let urlObj = new URL(base + input);
            if (token) {
              urlObj.searchParams.set('token', token);
            }
            input = urlObj.toString();
          }
          return originalFetch(input, init);
        };
        
        document.addEventListener('DOMContentLoaded', function() {
          const hasSavedBase = localStorage.getItem('ifmis_api_base');
          
          const isLocal = window.location.hostname === 'localhost' || 
                          window.location.hostname === '127.0.0.1' || 
                          window.location.hostname === '[::1]' ||
                          window.location.hostname.startsWith('192.168.') ||
                          window.location.hostname.startsWith('10.') ||
                          window.location.hostname.startsWith('172.');
          
          if (!window.location.protocol.startsWith('http')) {
            if (!hasSavedBase) {
              console.log('Running in pure offline standalone mode.');
              return;
            }
          } else {
            if (!isLocal && !hasSavedBase) {
              console.log('Running on public static host client-only.');
              return;
            }
          }
          
          const base = window.location.protocol.startsWith('http') ? window.location.origin : hasSavedBase;
          fetch('/api/config')
            .then(res => {
              if (!res.ok) throw new Error();
              console.log('Connected to IFMIS backend successfully at ' + base);
            })
            .catch(err => {
              console.warn('Could not connect to IFMIS backend at ' + base);
              showConnectionBanner(base);
            });
        });

        function showConnectionBanner(currentBase) {
          if (document.getElementById('ifmis-connection-banner')) return;
          const div = document.createElement('div');
          div.id = 'ifmis-connection-banner';
          div.style.position = 'fixed';
          div.style.bottom = '20px';
          div.style.right = '20px';
          div.style.zIndex = '99999';
          div.style.backgroundColor = '#1e293b';
          div.style.border = '1px solid #ef4444';
          div.style.borderRadius = '12px';
          div.style.padding = '16px';
          div.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.5)';
          div.style.color = '#f8fafc';
          div.style.fontFamily = 'system-ui, -apple-system, sans-serif';
          div.style.width = '320px';
          div.innerHTML = `
            <div style="font-weight: bold; color: #f8fafc; font-size: 13px; display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 8px;">
              <span><span style="color: #ef4444;">⚠️</span> Backend Connection Error</span>
              <button onclick="document.getElementById('ifmis-connection-banner').remove()" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 16px; font-weight: bold; padding: 0 4px; line-height: 1;">&times;</button>
            </div>
            <div style="font-size: 11px; color: #94a3b8; line-height: 1.4; margin-bottom: 12px;">
              Failed to connect to the IFMIS API server. If running locally, make sure the Python script or executable is running.
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <input type="text" id="ifmis-api-input" value="${currentBase}" 
                style="width: 100%; box-sizing: border-box; padding: 6px 10px; background-color: #0f172a; border: 1px solid #475569; border-radius: 6px; color: #f8fafc; font-size: 11px; outline: none;" 
                placeholder="http://127.0.0.1:5000" />
              <button id="ifmis-api-connect-btn" 
                style="width: 100%; padding: 6px 12px; background-color: #3b82f6; color: white; border: none; border-radius: 6px; font-weight: bold; font-size: 11px; cursor: pointer; transition: background 0.2s;">
                Connect Server
              </button>
            </div>
          `;
          document.body.appendChild(div);
          const input = document.getElementById('ifmis-api-input');
          const btn = document.getElementById('ifmis-api-connect-btn');
          btn.addEventListener('click', function() {
            let url = input.value.trim();
            if (!url) return;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
              url = 'http://' + url;
            }
            btn.innerText = 'Connecting...';
            btn.style.backgroundColor = '#475569';
            btn.disabled = true;
            const checkUrl = url.endsWith('/') ? url + 'api/config' : url + '/api/config';
            const cleanBaseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
            fetch(checkUrl, { mode: 'cors' })
              .then(res => {
                if (!res.ok) throw new Error();
                return res.json();
              })
              .then(data => {
                localStorage.setItem('ifmis_api_base', cleanBaseUrl);
                btn.innerText = 'Connected! Reloading...';
                btn.style.backgroundColor = '#10b981';
                setTimeout(() => { window.location.reload(); }, 800);
              })
              .catch(err => {
                alert('Failed to connect to backend server at ' + cleanBaseUrl + '\nPlease verify that the python script is running and the port is correct.');
                btn.innerText = 'Connect Server';
                btn.style.backgroundColor = '#3b82f6';
                btn.disabled = false;
              });
          });
        }

        // ==============================================================================
        // MIGRATED BACKEND ANALYSIS LOGIC OVERRIDES (LOCAL STANDALONE IMPLEMENTATION)
        // ==============================================================================
        
        // 1. Holiday Dictionaries
        const YEAR_SPECIFIC_HOLIDAYS = {
          '2024-03-25': 'Holi', '2025-03-14': 'Holi', '2026-03-03': 'Holi',
          '2024-04-10': 'Eid-ul-Fitr', '2025-03-31': 'Eid-ul-Fitr', '2026-03-21': 'Eid-ul-Fitr',
          '2024-11-01': 'Diwali', '2025-10-20': 'Diwali', '2026-11-08': 'Diwali',
          '2024-03-29': 'Good Friday', '2025-04-18': 'Good Friday', '2026-04-03': 'Good Friday',
          '2024-10-12': 'Dussehra', '2025-10-02': 'Dussehra',
          '2024-08-26': 'Janmashtami', '2025-08-15': 'Janmashtami',
          '2024-06-17': 'Eid-ul-Adha', '2025-06-07': 'Eid-ul-Adha'
        };

        const RECURRING_HOLIDAYS = {
          '01-26': 'Republic Day', '08-15': 'Independence Day', '10-02': 'Gandhi Jayanti',
          '12-25': 'Christmas', '04-14': 'Dr. Ambedkar Jayanti', '01-14': 'Makar Sankranti',
          // v2.3 D-9: MP state-specific recurring holidays
          '11-01': 'Madhya Pradesh Foundation Day', '12-03': 'Bhopal Gas Tragedy Memorial Day',
          '05-01': 'Labour Day (May Day)', '11-14': "Children's Day"
        };

        // 2. Text Normalization and Date Parsing Cleaners
        function ii(t) {
          if (!t) return "";
          let e = String(t).trim();
          if (/^[+\-]?\d+(\.\d+)?[eE][+\-]?\d+$/.test(e)) {
            const r = Number(e);
            if (!isNaN(r)) e = r.toFixed(0);
          }
          if (e.endsWith(".0")) e = e.slice(0, -2);
          return e.replace(/\s+/g, "").replace(/[^\w]/g, "").toUpperCase();
        }

        function io(t) {
          if (!t) return "";
          let e = String(t).trim();
          if (e.endsWith(".0")) e = e.slice(0, -2);
          return e.toUpperCase().replace(/\s+/g, "");
        }

        function Rc(t) {
          if (!t) return "";
          let e = String(t).toUpperCase().trim();
          e = e.replace(/[^\w\s]/g, " ");
          e = e.replace(/\s+/g, " ").trim();
          ["PVT LTD", "PRIVATE LIMITED", "LIMITED", "LTD", "PVT", "UNIT OF", "UO", "BRANCH"].forEach(a => {
            e = e.replace(new RegExp(`\\s*${a}\\s*`, "gi"), " ");
          });
          return e.trim();
        }

        function bc(t) {
          if (!t) return null;
          const e = t instanceof Date ? t : window.parseDDMMYYYY(t);
          return isNaN(e.getTime()) ? null : e;
        }

        // 3. Date and Currency Formatting helpers
        const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        function formatDate(date) {
          if (!date) return "";
          const d = date instanceof Date ? date : window.parseDDMMYYYY(date);
          if (!d || isNaN(d.getTime())) return typeof date === 'string' ? date : "";
          const day = String(d.getDate()).padStart(2, '0');
          const month = MONTH_NAMES[d.getMonth()];
          const year = d.getFullYear();
          return `${day}-${month}-${year}`;
        }

        function formatIndianCurrency(number) {
          try {
            const val = Math.round(Number(number));
            if (isNaN(val)) return String(number);
            return val.toLocaleString('en-IN');
          } catch (e) {
            return String(number);
          }
        }

        // 4. Standard Row Formatting helper
        // D-7 v2.3.2: _shortReason() extracts first sentence of a reason string
        // for the Why_Flagged column (scannable). Full text goes to AUDIT_ISSUE.
        function _shortReason(full) {
          if (!full) return "";
          // Take up to first "|" separator, ":" with detail after, or 90 chars
          const pipeIdx = full.indexOf(" | ");
          const colonIdx = full.indexOf(": ");
          // If the string has a "|" separator, the part before it is already the summary
          if (pipeIdx > 20 && pipeIdx < 120) return full.slice(0, pipeIdx).trim();
          // If very short already, return as-is
          if (full.length <= 90) return full;
          // Otherwise truncate at last word boundary before 90 chars
          const cut = full.slice(0, 90);
          const lastSpace = cut.lastIndexOf(" ");
          return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut) + "…";
        }

        function formatOutputRow(t, auditFlag, whyFlagged) {
          const month = t.fyMonth || t.paymentMonth || "";
          const year = t.fyYear || t.paymentYear || "";
          const dateFormatted = formatDate(t.dateOfPayment);
          return {
            Account_No: t.accountNo || "",
            Party_Code: t.partyCode || "",
            Beneficiary_Name: t.partyName || "",
            Vou_No: t.serialNo || t.voucherNo || "",
            Raw_Voucher_Number: t.voucherNo || "",
            TRY_Code: t.tryCodeNum || "",
            TRY_Name: t.tryCodeChar || "",
            MHCD: t.majorHead || "",
            Month: month,
            Year: year,
            Date: dateFormatted,
            Amount: t.amountPaid || 0,
            Bill_Type: t.billType || "",
            DDO_Code: t.ddoCode || t.DDO_Code || t["DDO_Code"] || "", // v2.3 FIX
            DDO_Name: t.ddoName || t.DDO_Name || t["DDO_Name"] || "", // v2.3 FIX
            IFSC: t.ifscCode || "",
            UTR_No: t.utrNo || "",
            Bank_Name: t.bankName || "",
            Bank_Branch: t.bankBranch || "",
            Source_File: t.sourceFile || "",
            Audit_Notes: t.auditNotes || "",
            AUDIT_FLAG:  auditFlag || "",
            // D-7 v2.3.2: Why_Flagged = short 1-line summary; AUDIT_ISSUE = full detail
            AUDIT_ISSUE: whyFlagged || "",
            Why_Flagged: _shortReason(whyFlagged),
            Bill_Ref_No: t.billRefNo || ""
          };
        }

        // 5. String Similarity helpers (Levenshtein Token Sort Ratio)
        function levenshtein(s1, s2) {
          const len1 = s1.length, len2 = s2.length;
          let prev = Array(len2 + 1).fill(0).map((_, i) => i);
          let curr = Array(len2 + 1).fill(0);
          for (let i = 1; i <= len1; i++) {
            curr[0] = i;
            for (let j = 1; j <= len2; j++) {
              const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
              curr[j] = Math.min(
                curr[j - 1] + 1,
                prev[j] + 1,
                prev[j - 1] + cost
              );
            }
            [prev, curr] = [curr, prev];
          }
          return prev[len2];
        }

        function fuzzRatio(s1, s2) {
          if (s1 === s2) return 100;
          const len1 = s1.length, len2 = s2.length;
          if (len1 === 0 || len2 === 0) return 0;
          const dist = levenshtein(s1, s2);
          return ((len1 + len2 - dist) / (len1 + len2)) * 100;
        }

        function tokenSortRatio(s1, s2) {
          const clean = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean).sort().join(' ');
          const sorted1 = clean(s1);
          const sorted2 = clean(s2);
          return fuzzRatio(sorted1, sorted2);
        }

        // 6. Migrated Checks (Flags 1-4, 10, Generic Conflict check)
        function run_flag_1(records) {
          const COL_ACC = "accountNo";
          const COL_NAME = "partyName";
          const COL_AMOUNT = "amountPaid";
          
          const accToRawRows = {};
          const nameCounts = {};
          
          records.forEach(r => {
            const acc = ii(r[COL_ACC]);
            const name = Rc(r[COL_NAME]);
            if (!acc || !name) return;
            
            const key = `${acc}|${name}`;
            nameCounts[key] = (nameCounts[key] || 0) + 1;
            
            if (!accToRawRows[acc]) {
              accToRawRows[acc] = [];
            }
            accToRawRows[acc].push(r);
          });
          
          const accToValidNames = {};
          Object.keys(nameCounts).forEach(key => {
            const count = nameCounts[key];
            if (count > getSetting('fuzzy_name_freq_threshold', 2)) return; // ignore names appearing > threshold
            const [acc, name] = key.split('|');
            if (!accToValidNames[acc]) {
              accToValidNames[acc] = [];
            }
            accToValidNames[acc].push(name);
          });
          
          const flaggedAccs = [];
          const flaggedAccToValidNames = {};
          
          Object.keys(accToValidNames).forEach(acc => {
            const validNames = accToValidNames[acc];
            if (validNames.length < 2) return;
            
            let hasMismatch = false;
            const n = validNames.length;
            for (let i = 0; i < n; i++) {
              for (let j = i + 1; j < n; j++) {
                const name1 = validNames[i];
                const name2 = validNames[j];
                
                const len1 = name1.length;
                const len2 = name2.length;
                if ((2.0 * Math.min(len1, len2) / (len1 + len2)) * 100.0 < getSetting('fuzzy_name_similarity', 75.0)) {
                  hasMismatch = true;
                  break;
                }
                
                const sim = tokenSortRatio(name1, name2);
                if (sim < getSetting('fuzzy_name_similarity', 75.0)) {
                  hasMismatch = true;
                  break;
                }
              }
              if (hasMismatch) break;
            }
            
            if (hasMismatch) {
              flaggedAccs.push(acc);
              flaggedAccToValidNames[acc] = new Set(validNames);
            }
          });
          
          if (flaggedAccs.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "✅ No fuzzy name anomalies detected"
            };
          }
          
          const flaggedRows = [];
          const seenCombos = new Set();
          
          flaggedAccs.forEach(acc => {
            const validNamesSet = flaggedAccToValidNames[acc];
            const rawRows = accToRawRows[acc];
            
            rawRows.forEach(row => {
              const nameNorm = Rc(row[COL_NAME]);
              if (!validNamesSet.has(nameNorm)) return;
              
              const comboKey = `${acc}|${nameNorm}`;
              if (seenCombos.has(comboKey)) return;
              seenCombos.add(comboKey);
              
              let maxDev = 0.0;
              const validNamesList = Array.from(validNamesSet);
              validNamesList.forEach(otherName => {
                if (otherName === nameNorm) return;
                const sim = tokenSortRatio(nameNorm, otherName);
                const dev = 100.0 - sim;
                if (dev > maxDev) maxDev = dev;
              });
              
              const formatted = formatOutputRow(row, "Flagged: Fuzzy Name Deviation", `Fuzzy Name mismatch: name deviates by ${maxDev.toFixed(1)}% from other names on the same account`);
              formatted.Deviation = maxDev;
              formatted.Why_Flagged = `Fuzzy Name mismatch: name deviates by ${maxDev.toFixed(1)}% from other names on the same account`;
              formatted.AUDIT_ISSUE = formatted.Why_Flagged;
              formatted.Risk_Score = maxDev > 40 ? 80 : 60;
              formatted.Duplicate_Group = acc;
              flaggedRows.push(formatted);
            });
          });
          
          // Calculate max deviation per account group
          const groupMaxDev = {};
          flaggedRows.forEach(row => {
            const acc = row.Duplicate_Group;
            const dev = row.Deviation;
            if (groupMaxDev[acc] === undefined || dev > groupMaxDev[acc]) {
              groupMaxDev[acc] = dev;
            }
          });
          
          flaggedRows.sort((a, b) => {
            const devA = groupMaxDev[a.Duplicate_Group];
            const devB = groupMaxDev[b.Duplicate_Group];
            
            if (Math.abs(devB - devA) > 0.0001) {
              return devB - devA;
            }
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            return b.Deviation - a.Deviation;
          });
          
          const totalAmount = flaggedRows.reduce((sum, r) => sum + r.Amount, 0);
          const uniqueAccountsCount = flaggedAccs.length;
          const uniqueBenefNames = new Set(flaggedRows.map(r => r.Beneficiary_Name)).size;
          
          return {
            data: flaggedRows,
            irregularFields: ["Account_No", "Beneficiary_Name", "Deviation"],
            findings: [
              { Metric: "Distinct Entries", Value: flaggedRows.length.toString() },
              { Metric: "Account Numbers", Value: uniqueAccountsCount.toString() },
              { Metric: "Unique Party Names", Value: uniqueBenefNames.toString() },
              { Metric: "Total Amount Involved", Value: `₹${formatIndianCurrency(totalAmount)}` }
            ],
            summary: `🚨 Found ${uniqueAccountsCount} account(s) linked to multiple distinct Party Names`
          };
        }

        function run_flag_2(records) {
          const COL_ACC = "accountNo";
          const COL_CODE = "partyCode";
          const COL_AMOUNT = "amountPaid";
          
          const accToCodes = {};
          const accToRows = {};
          
          records.forEach(r => {
            const acc = ii(r[COL_ACC]);
            const code = io(r[COL_CODE]);
            if (!acc || !code) return;
            
            if (!accToCodes[acc]) {
              accToCodes[acc] = new Set();
              accToRows[acc] = [];
            }
            accToCodes[acc].add(code);
            accToRows[acc].push(r);
          });
          
          const flaggedAccs = [];
          Object.keys(accToCodes).forEach(acc => {
            if (accToCodes[acc].size >= 2) {
              flaggedAccs.push(acc);
            }
          });
          
          if (flaggedAccs.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "✅ No multiple party codes per account detected"
            };
          }
          
          const flaggedRows = [];
          flaggedAccs.forEach(acc => {
            const rows = accToRows[acc];
            const codesStr = Array.from(accToCodes[acc]).join(", ");
            rows.forEach(r => {
              const formatted = formatOutputRow(r, "Flagged: Multiple Party Codes", `Account linked to multiple distinct Party Codes: ${codesStr}`);
              formatted.Why_Flagged = `Account linked to multiple distinct Party Codes: ${codesStr}`;
              formatted.AUDIT_ISSUE = formatted.Why_Flagged;
              formatted.Risk_Score = 60;
              formatted.Duplicate_Group = acc;
              flaggedRows.push(formatted);
            });
          });
          
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          
          const totalAmount = flaggedRows.reduce((sum, r) => sum + r.Amount, 0);
          const uniqueCodesCount = new Set(flaggedRows.map(r => r.Party_Code)).size;
          
          return {
            data: flaggedRows,
            irregularFields: ["Account_No", "Party_Code"],
            findings: [
              { Metric: "Flagged Accounts", Value: flaggedAccs.length.toString() },
              { Metric: "Distinct Party Codes", Value: uniqueCodesCount.toString() },
              { Metric: "Total Flagged Rows", Value: flaggedRows.length.toString() },
              { Metric: "Total Amount Involved", Value: `₹${formatIndianCurrency(totalAmount)}` }
            ],
            summary: `🚨 Found ${flaggedAccs.length} account(s) linked to multiple distinct Party Codes`
          };
        }

        function run_flag_3(records) {
          const accGroups = {};
          
          records.forEach(r => {
            const acc = ii(r.accountNo);
            if (!acc) return;
            
            const partyCode = io(r.partyCode);
            const key = `${acc}|${partyCode}`;
            
            if (!accGroups[key]) {
              accGroups[key] = {
                accountNo: acc,
                partyCode: r.partyCode || "",
                partyName: r.partyName || "",
                count: 0,
                total: 0,
                min: Infinity,
                max: -Infinity,
                billTypes: new Set(),
                sourceFiles: new Set()
              };
            }
            
            const g = accGroups[key];
            g.count++;
            g.total += r.amountPaid || 0;
            g.min = Math.min(g.min, r.amountPaid || 0);
            g.max = Math.max(g.max, r.amountPaid || 0);
            if (r.billType) g.billTypes.add(r.billType);
            if (r.sourceFile) g.sourceFiles.add(r.sourceFile);
          });
          
          const output = Object.values(accGroups).map(g => ({
            Account_No: g.accountNo,
            Party_Code: g.partyCode,
            Beneficiary_Name: g.partyName,
            Payment_Count: g.count,
            Total_Amount: g.total,
            Min_Amount: g.min === Infinity ? 0 : g.min,
            Max_Amount: g.max === -Infinity ? 0 : g.max,
            Avg_Amount: g.count > 0 ? Math.round((g.total / g.count) * 100) / 100 : 0,
            Bill_Types: Array.from(g.billTypes).join(", "),
            Source_Files: Array.from(g.sourceFiles).join(", ")
          }));
          
          output.sort((a, b) => b.Total_Amount - a.Total_Amount);
          
          const totalPayments = records.length;
          const totalAmount = records.reduce((sum, r) => sum + (r.amountPaid || 0), 0);
          
          return {
            data: output,
            irregularFields: [],
            findings: [
              { Metric: "Total Accounts", Value: output.length.toString() },
              { Metric: "Total Payments", Value: totalPayments.toString() },
              { Metric: "Total Amount", Value: `₹${formatIndianCurrency(totalAmount)}` }
            ],
            summary: `ℹ️ Account-wise summary loaded: ${output.length} unique accounts`
          };
        }

        function run_flag_4(records) {
          const COL_ACC = "accountNo";
          const COL_AMOUNT = "amountPaid";
          const COL_BT = "billType";
          const COL_NAME = "partyName";
          
          const payBillCounts = {};
          records.forEach(r => {
            const acc = ii(r[COL_ACC]);
            if (!acc) return;
            const ifsc = String(r.ifscCode || r.ifsccode || r.ifsc || '').trim().toUpperCase();
            const key = `${acc}|${ifsc}`;
            const bt = String(r[COL_BT] || '').trim().toUpperCase();
            if (bt === "PAY BILL") {
              payBillCounts[key] = (payBillCounts[key] || 0) + 1;
            }
          });
          
          const excludeKeys = new Set();
          Object.keys(payBillCounts).forEach(key => {
            if (payBillCounts[key] <= getSetting('dup_paybill_exclude_freq', 12)) {
              excludeKeys.add(key);
            }
          });
          
          const filteredRecords = records.filter(r => {
            const acc = ii(r[COL_ACC]);
            const ifsc = String(r.ifscCode || r.ifsccode || r.ifsc || '').trim().toUpperCase();
            const key = `${acc}|${ifsc}`;
            const bt = String(r[COL_BT] || '').trim().toUpperCase();
            if (bt === "PAY BILL" || bt.includes("PAY BILL") || bt.includes("PAY_BILL")) {
              return false;
            }
            return true;
          });
          
          const groupMap = {};
          filteredRecords.forEach(r => {
            const acc = ii(r[COL_ACC]);
            const amt = Number(r[COL_AMOUNT]);
            const ifsc = String(r.ifscCode || r.ifsccode || r.ifsc || '').trim().toUpperCase();
            const bt = String(r.billType || r.Bill_Type || r.BillType || r["Bill Type"] || '').trim().toUpperCase();
            if (bt === "PAY BILL" || bt.includes("PAY BILL") || bt.includes("PAY_BILL")) return;
            if (!acc || isNaN(amt) || amt <= 0) return;
            if (amt < getSetting('dup_payment_min_amount', 5000)) return;
            
            // v2.3 A-11: Scope duplicates to financial year (avoids flagging annual salary payments)
            const _d8b = bc(r.dateOfPayment);
            const _fy8b = _d8b ? (_d8b.getMonth() >= 3 ? _d8b.getFullYear() : _d8b.getFullYear() - 1) : 0;
            const key = `${acc}|${ifsc}|${amt}|${_fy8b}`;
            if (!groupMap[key]) {
              groupMap[key] = [];
            }
            groupMap[key].push(r);
          });
          
          const flaggedRows = [];
          let duplicateGroupsCount = 0;
          const partyNamesInvolved = new Set();
          
          Object.keys(groupMap).forEach(key => {
            const group = groupMap[key];
            if (group.length < 2) return;
            
            // Parse dates and sort
            const parsedRows = group.map(r => ({ ...r, parsedDate: window.parseDDMMYYYY(r.dateOfPayment) }))
                                    .filter(r => r.parsedDate !== null)
                                    .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
            
            if (parsedRows.length < 2) return;
            
            // Find duplicate payments within 14 days of each other
            const flaggedInGroup = [];
            for (let i = 0; i < parsedRows.length; i++) {
              let hasDuplicateNeighbor = false;
              for (let j = 0; j < parsedRows.length; j++) {
                if (i === j) continue;
                const diffMs = Math.abs(parsedRows[i].parsedDate.getTime() - parsedRows[j].parsedDate.getTime());
                const diffDays = diffMs / (1000 * 60 * 60 * 24);
                if (diffDays <= getSetting('dup_window_days', 90)) { // v2.3: default window widened to 90 days
                  hasDuplicateNeighbor = true;
                  break;
                }
              }
              if (hasDuplicateNeighbor) {
                flaggedInGroup.push(parsedRows[i]);
              }
            }
            
            if (flaggedInGroup.length >= 2) {
              duplicateGroupsCount++;
              const [acc, ifsc, amt] = key.split('|');
              const dupGroupLabel = `${acc}_${ifsc}_${amt}`;
              
              flaggedInGroup.forEach(r => {
                const formatted = formatOutputRow(r, "Flagged: Duplicate Payment", `Potential duplicate payment: same account, IFSC (${ifsc || 'N/A'}) and amount (₹${formatIndianCurrency(amt)}) paid multiple times within ` + getSetting('dup_window_days', 14) + ` days`);
                formatted.Why_Flagged = `Potential duplicate payment: same account, IFSC (${ifsc || 'N/A'}) and amount (₹${formatIndianCurrency(amt)}) paid multiple times within ` + getSetting('dup_window_days', 14) + ` days`;
                formatted.AUDIT_ISSUE = formatted.Why_Flagged;
                formatted.Risk_Score = group.length >= 3 ? 90 : 70;
                formatted.Duplicate_Group = dupGroupLabel;
                flaggedRows.push(formatted);
                if (r[COL_NAME]) partyNamesInvolved.add(r[COL_NAME]);
              });
            }
          });
          
          if (flaggedRows.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "✅ No duplicate payments detected"
            };
          }
          
          // Sort consecutively by Duplicate_Group to enable visual grouping in table, and secondarily by date
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group < b.Duplicate_Group ? -1 : 1;
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          
          const totalAmount = flaggedRows.reduce((sum, r) => sum + r.Amount, 0);
          
          return {
            data: flaggedRows,
            irregularFields: ["Account_No", "IFSC", "Amount", "Vou_No"],
            findings: [
              { Metric: "Duplicate Groups", Value: duplicateGroupsCount.toString() },
              { Metric: "Party Names Involved", Value: partyNamesInvolved.size.toString() },
              { Metric: "Total Flagged Rows", Value: flaggedRows.length.toString() },
              { Metric: "Total Amount Involved", Value: `₹${formatIndianCurrency(totalAmount)}` }
            ],
            summary: `🚨 Duplicate Payments: Found ${duplicateGroupsCount} groups of duplicate payments`
          };
        }

        function run_flag_8b(records) {
          const COL_ACC = "accountNo";
          const COL_AMOUNT = "amountPaid";
          const COL_BT = "billType";
          const COL_NAME = "partyName";
          
          const filteredRecords = records.filter(r => {
            const bt = String(r[COL_BT] || '').trim().toUpperCase();
            if (bt === "PAY BILL" || bt.includes("PAY BILL") || bt.includes("PAY_BILL")) {
              return false;
            }
            return true;
          });
          
          const groupMap = {};
          filteredRecords.forEach(r => {
            const acc = ii(r[COL_ACC]);
            const amt = Number(r[COL_AMOUNT]);
            const ifsc = String(r.ifscCode || r.ifsccode || r.ifsc || '').trim().toUpperCase();
            const bt = String(r.billType || r.Bill_Type || r.BillType || r["Bill Type"] || '').trim().toUpperCase();
            if (bt === "PAY BILL" || bt.includes("PAY BILL") || bt.includes("PAY_BILL")) return;
            if (!acc || isNaN(amt) || amt <= 0) return;
            if (amt < getSetting('dup_payment_min_amount', 5000)) return;
            
            // v2.3 A-11: Scope duplicates to financial year (avoids flagging annual salary payments)
            const _d8b = bc(r.dateOfPayment);
            const _fy8b = _d8b ? (_d8b.getMonth() >= 3 ? _d8b.getFullYear() : _d8b.getFullYear() - 1) : 0;
            const key = `${acc}|${ifsc}|${amt}|${_fy8b}`;
            if (!groupMap[key]) {
              groupMap[key] = [];
            }
            groupMap[key].push(r);
          });
          
          const flaggedRows = [];
          let duplicateGroupsCount = 0;
          const partyNamesInvolved = new Set();
          
          Object.keys(groupMap).forEach(key => {
            const group = groupMap[key];
            if (group.length < 2) return;
            
            duplicateGroupsCount++;
            const [acc, ifsc, amt] = key.split('|');
            const dupGroupLabel = `${acc}_${ifsc}_${amt}`;
            
            group.forEach(r => {
              const formatted = formatOutputRow(r, "Flagged: Duplicate Payment (No Limit)", `Potential duplicate payment: same account, IFSC (${ifsc || 'N/A'}) and amount (₹${formatIndianCurrency(amt)}) paid multiple times`);
              formatted.Why_Flagged = `Potential duplicate payment: same account, IFSC (${ifsc || 'N/A'}) and amount (₹${formatIndianCurrency(amt)}) paid multiple times`;
              formatted.AUDIT_ISSUE = formatted.Why_Flagged;
              formatted.Risk_Score = group.length >= 3 ? 90 : 70;
              formatted.Duplicate_Group = dupGroupLabel;
              flaggedRows.push(formatted);
              if (r[COL_NAME]) partyNamesInvolved.add(r[COL_NAME]);
            });
          });
          
          if (flaggedRows.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "✅ No duplicate payments (no limit) detected"
            };
          }
          
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group < b.Duplicate_Group ? -1 : 1;
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          
          const totalAmount = flaggedRows.reduce((sum, r) => sum + r.Amount, 0);
          
          return {
            data: flaggedRows,
            irregularFields: ["Account_No", "IFSC", "Amount", "Vou_No"],
            findings: [
              { Metric: "Duplicate Groups", Value: duplicateGroupsCount.toString() },
              { Metric: "Party Names Involved", Value: partyNamesInvolved.size.toString() },
              { Metric: "Total Flagged Rows", Value: flaggedRows.length.toString() },
              { Metric: "Total Amount Involved", Value: `₹${formatIndianCurrency(totalAmount)}` }
            ],
            summary: `🚨 Duplicate Payments (No Limit): Found ${duplicateGroupsCount} groups of duplicate payments`
          };
        }

        function isPayBillRow(r) {
          const bt = String(r.billType || r.Bill_Type || r.BillType || r["Bill Type"] || r.BT || '').trim().toUpperCase();
          if (bt.includes("ARREAR") || bt.includes("ARREARS")) return false;

          const ref = String(r.billRefNo || r.Bill_Ref_No || r.BillRefNo || r["Bill Reference Number"] || r.Bill_Reference_Number || r.Ref_No || '').trim().toUpperCase();
          if (ref.includes("ARREAR") || ref.includes("ARREARS")) return false;

          const normalizedRef = ref.replace(/\\/g, '/');
          if (normalizedRef.includes("PAY BILL") || normalizedRef.includes("PAY_BILL")) {
            const slashes = normalizedRef.split('/');
            if (slashes.length > 2) {
              return false;
            }
          }

          return bt === "PAY BILL" || bt.includes("PAY BILL") || bt.includes("PAY_BILL");
        }

        function isValidUTR(utr) {
          if (utr === undefined || utr === null) return false;
          const s = String(utr).trim().toUpperCase();
          if (s === '' || s === 'NAN' || s === '0' || s === 'NA' || s === 'N/A' || s === 'PENDING' || s === 'NULL' || s === 'UNDEFINED' || s === 'NONE') {
            return false;
          }
          return true;
        }

        function run_flag_6c(records) {
          const COL_NAME = "partyName";
          const COL_AMOUNT = "amountPaid";
          const groupMap = {};
          records.forEach(r => {
            if (isPayBillRow(r)) return;
            const rawName = String(r[COL_NAME] || '').trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '');
            const amt = Number(r[COL_AMOUNT]);
            if (!rawName || rawName.length < 2 || isNaN(amt) || amt <= 0) return;
            const key = `${rawName}|${amt}`;
            if (!groupMap[key]) groupMap[key] = [];
            groupMap[key].push(r);
          });
          const flaggedRows = [];
          let duplicateGroupsCount = 0;
          Object.keys(groupMap).forEach(key => {
            const group = groupMap[key];
            if (group.length < 2) return;
            duplicateGroupsCount++;
            const [name, amtStr] = key.split('|');
            const amt = Number(amtStr);
            group.forEach(r => {
              const formatted = formatOutputRow(r, "Flagged: Duplicate Payment (Name + Amount)", `Potential duplicate payment: same beneficiary name ('${name}') and amount (₹${formatIndianCurrency(amt)}) paid ${group.length} times`);
              formatted.Why_Flagged = `Potential duplicate payment: same beneficiary name ('${name}') and amount (₹${formatIndianCurrency(amt)}) paid ${group.length} times`;
              formatted.AUDIT_ISSUE = formatted.Why_Flagged;
              formatted.Risk_Score = group.length >= 4 ? 60 : 40;
              formatted.AUDIT_FLAG = group.length >= 4 ? "IRREGULAR" : "WARNING";
              flaggedRows.push(formatted);
            });
          });
          return {
            data: flaggedRows,
            stats: [
              { Metric: "Flagged Rows", Value: flaggedRows.length.toLocaleString() },
              { Metric: "Duplicate Groups Count", Value: duplicateGroupsCount.toLocaleString() }
            ],
            summary: `🚨 Duplicate Payments (Name + Amount): Found ${duplicateGroupsCount} groups of duplicate payments with identical beneficiary name and amount`
          };
        }

        function run_flag_6d(records) {
          const COL_ACC = "accountNo";
          const COL_AMOUNT = "amountPaid";
          const groupMap = {};
          records.forEach(r => {
            if (isPayBillRow(r)) return;
            const acc = ii(r[COL_ACC]);
            const amt = Number(r[COL_AMOUNT]);
            const bt = String(r.billType || r.Bill_Type || r.BillType || r["Bill Type"] || '').trim().toUpperCase();
            if (bt === "PAY BILL" || bt.includes("PAY BILL") || bt.includes("PAY_BILL")) return;
            if (!acc || isNaN(amt) || amt <= 0) return;
            if (amt < getSetting('dup_payment_min_amount', 5000)) return;
            const key = `${acc}|${amt}`;
            if (!groupMap[key]) groupMap[key] = [];
            groupMap[key].push(r);
          });
          const flaggedRows = [];
          let duplicateGroupsCount = 0;
          Object.keys(groupMap).forEach(key => {
            const group = groupMap[key];
            if (group.length < 2) return;
            duplicateGroupsCount++;
            const [acc, amtStr] = key.split('|');
            const amt = Number(amtStr);
            group.forEach(r => {
              const formatted = formatOutputRow(r, "Flagged: Duplicate Payment (Account + Amount)", `Potential duplicate payment: same account number (${acc}) and amount (₹${formatIndianCurrency(amt)}) paid ${group.length} times`);
              formatted.Why_Flagged = `Potential duplicate payment: same account number (${acc}) and amount (₹${formatIndianCurrency(amt)}) paid ${group.length} times`;
              formatted.AUDIT_ISSUE = formatted.Why_Flagged;
              formatted.Risk_Score = group.length >= 4 ? 60 : 40;
              formatted.AUDIT_FLAG = group.length >= 4 ? "IRREGULAR" : "WARNING";
              flaggedRows.push(formatted);
            });
          });
          return {
            data: flaggedRows,
            stats: [
              { Metric: "Flagged Rows", Value: flaggedRows.length.toLocaleString() },
              { Metric: "Duplicate Groups Count", Value: duplicateGroupsCount.toLocaleString() }
            ],
            summary: `🚨 Duplicate Payments (Account + Amount): Found ${duplicateGroupsCount} groups of duplicate payments with identical account number and amount`
          };
        }

        function run_flag_6e(records) {
          const COL_ACC = "accountNo";
          const COL_AMOUNT = "amountPaid";
          const getSettingFn = (typeof self !== "undefined" && typeof self.getSetting === "function") ? self.getSetting : ((typeof getSetting === "function") ? getSetting : function(k, d){ return d; });
          const rawTarget = String(getSettingFn('dup_major_head_code', '2235, 2245, 8011')).trim();
          const targetList = rawTarget.split(',').map(s => s.trim()).filter(Boolean);
          
          const filteredRecords = records.filter(r => {
            if (isPayBillRow(r)) return false;
            const mh = String(
              r.majorHead || 
              r.MHCD || 
              r.Major_Head || 
              r.MajorHead || 
              r.major_head || 
              r.HOA || 
              r.Head_of_Account || 
              r.TRY_Code || 
              (r.voucherDetails && r.voucherDetails.majorHead) || 
              r.voucherNo || 
              ''
            ).trim();
            if (targetList.length === 0) return true;
            return targetList.some(target => mh.indexOf(target) !== -1);
          });
          const groupMap = {};
          filteredRecords.forEach(r => {
            const acc = ii(r[COL_ACC]);
            const amt = Number(r[COL_AMOUNT]);
            const bt = String(r.billType || r.Bill_Type || r.BillType || r["Bill Type"] || '').trim().toUpperCase();
            if (bt === "PAY BILL" || bt.includes("PAY BILL") || bt.includes("PAY_BILL")) return;
            if (!acc || isNaN(amt) || amt <= 0) return;
            if (amt < getSetting('dup_payment_min_amount', 5000)) return;
            const key = `${acc}|${amt}`;
            if (!groupMap[key]) groupMap[key] = [];
            groupMap[key].push(r);
          });
          const flaggedRows = [];
          let duplicateGroupsCount = 0;
          Object.keys(groupMap).forEach(key => {
            const group = groupMap[key];
            if (group.length < 2) return;
            duplicateGroupsCount++;
            const [acc, amtStr] = key.split('|');
            const amt = Number(amtStr);
            group.forEach(r => {
              const formatted = formatOutputRow(r, `Flagged: Duplicate Payment (Major Head ${rawTarget})`, `Potential duplicate payment under Major Head ${rawTarget}: same account (${acc}) and amount (₹${formatIndianCurrency(amt)}) paid ${group.length} times`);
              formatted.Why_Flagged = `Potential duplicate payment under Major Head ${rawTarget}: same account (${acc}) and amount (₹${formatIndianCurrency(amt)}) paid ${group.length} times`;
              formatted.AUDIT_ISSUE = formatted.Why_Flagged;
              formatted.Risk_Score = group.length >= 4 ? 70 : 50;
              formatted.AUDIT_FLAG = group.length >= 4 ? "HIGH_RISK" : "IRREGULAR";
              formatted.Duplicate_Group = key;
              flaggedRows.push(formatted);
            });
          });
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          return {
            data: flaggedRows,
            stats: [
              { Metric: "Target Major Head(s)", Value: rawTarget },
              { Metric: "Flagged Rows", Value: flaggedRows.length.toLocaleString() },
              { Metric: "Duplicate Groups Count", Value: duplicateGroupsCount.toLocaleString() }
            ],
            summary: `🚨 Duplicate Payments (Major Head ${rawTarget}): Found ${duplicateGroupsCount} groups of duplicate payments under Major Head ${rawTarget}`
          };
        }

        function run_flag_paybill_excessive_freq(records) {
          const COL_ACC = "accountNo";
          const getSettingFn = (typeof self !== "undefined" && typeof self.getSetting === "function") ? self.getSetting : ((typeof getSetting === "function") ? getSetting : function(k, d){ return d; });
          const limit = Number(getSettingFn('paybill_freq_annual_limit', 25));
          
          const groupMap = {};
          records.forEach(r => {
            if (!isPayBillRow(r)) return;
            const acc = ii(r[COL_ACC]);
            if (!acc) return;
            
            // v2.3 D-10: Prefer dedicated Year/dateOfPayment fields; regex as last resort
            let year = "Unknown";
            if (r.Year && /^(19|20)\d{2}$/.test(String(r.Year).trim())) {
              year = String(r.Year).trim();
            } else {
              const dtStr = String(r.Date || r.Vou_Date || r.Voucher_Date || r.Date_Formatted || '').trim();
              const yearMatch = dtStr.match(/20\d\d|19\d\d/);
              if (yearMatch) { year = yearMatch[0]; }
            }
            
            const key = `${acc}|${year}`;
            if (!groupMap[key]) groupMap[key] = [];
            groupMap[key].push(r);
          });
          
          const flaggedRows = [];
          let flaggedAccountsCount = 0;
          
          Object.keys(groupMap).forEach(key => {
            const group = groupMap[key];
            if (group.length <= limit) return;
            flaggedAccountsCount++;
            const [acc, year] = key.split('|');
            group.forEach(r => {
              const formatted = formatOutputRow(r, "Flagged: Excessive PAY BILL Payments", `Excessive salary payments: account (${acc}) received ${group.length} PAY BILL payments in year ${year} (Exceeds limit of ${limit})`);
              formatted.Why_Flagged = `Excessive salary payments: account (${acc}) received ${group.length} PAY BILL payments in year ${year} (Exceeds limit of ${limit})`;
              formatted.AUDIT_ISSUE = formatted.Why_Flagged;
              formatted.Risk_Score = group.length >= (limit + 10) ? 70 : 50;
              formatted.AUDIT_FLAG = group.length >= (limit + 10) ? "HIGH_RISK" : "WARNING";
              formatted.Duplicate_Group = key;
              flaggedRows.push(formatted);
            });
          });
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          return {
            data: flaggedRows,
            stats: [
              { Metric: "Annual Limit Threshold", Value: limit },
              { Metric: "Flagged Accounts", Value: flaggedAccountsCount.toLocaleString() },
              { Metric: "Flagged Rows", Value: flaggedRows.length.toLocaleString() }
            ],
            summary: `🚨 Excessive PAY BILL Payments (> ${limit}/year): Found ${flaggedAccountsCount} accounts receiving > ${limit} PAY BILL payments in a single year`
          };
        }

        function run_flag_10(records) {
          const TARGET_TYPES = [
            "Pay Bill", "TA Bill", "FVC Bill", "Scholarship", "Grant", 
            "Pension", "Advnc76", "Arrear", "DPF/GPF", "Refund", 
            "RefundGST", "GSTRefundWorks", "WorkID", "CVP Bill", 
            "DCRG Bill", "Medical", "MPTC66"
          ];
          
          const sortedTargets = TARGET_TYPES.map(t => t.toUpperCase()).sort((a, b) => b.length - a.length);
          
          const accToMatchedTypes = {};
          const accToRows = {};
          
          records.forEach(r => {
            const acc = ii(r.accountNo);
            if (!acc) return;
            
            if (!accToMatchedTypes[acc]) {
              accToMatchedTypes[acc] = new Set();
              accToRows[acc] = [];
            }
            accToRows[acc].push(r);
            
            const bt = String(r.billType || '').trim().toUpperCase();
            for (let target of sortedTargets) {
              if (bt.includes(target)) {
                accToMatchedTypes[acc].add(target);
                break;
              }
            }
          });
          
          const flaggedAccs = [];
          Object.keys(accToMatchedTypes).forEach(acc => {
            if (accToMatchedTypes[acc].size >= 2) {
              flaggedAccs.push(acc);
            }
          });
          
          if (flaggedAccs.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "✅ No multi-type bill conflicts detected"
            };
          }
          
          const flaggedRows = [];
          flaggedAccs.forEach(acc => {
            const rows = accToRows[acc];
            const typesStr = Array.from(accToMatchedTypes[acc]).join(", ");
            rows.forEach(r => {
              const formatted = formatOutputRow(r, "Flagged: Multi-Type Bill Conflict", `Account paid via multiple diverse bill types: ${typesStr}`);
              formatted.Why_Flagged = `Account paid via multiple diverse bill types: ${typesStr}`;
              formatted.AUDIT_ISSUE = formatted.Why_Flagged;
              formatted.Risk_Score = 50;
              formatted.Duplicate_Group = acc;
              flaggedRows.push(formatted);
            });
          });
          
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          
          const totalAmount = flaggedRows.reduce((sum, r) => sum + r.Amount, 0);
          const uniqueNamesCount = new Set(flaggedRows.map(r => r.Beneficiary_Name)).size;
          
          return {
            data: flaggedRows,
            irregularFields: ["Account_No", "Bill_Type"],
            findings: [
              { Metric: "Account Numbers", Value: flaggedAccs.length.toString() },
              { Metric: "Party Names", Value: uniqueNamesCount.toString() },
              { Metric: "Total Flagged Rows", Value: flaggedRows.length.toString() },
              { Metric: "Total Amount Involved", Value: `₹${formatIndianCurrency(totalAmount)}` }
            ],
            summary: `🚨 Found ${flaggedAccs.length} account(s) paid via multiple target bill types`
          };
        }

        function runConflictCheck(records, kw_a, kw_b, checkName, desc, labelA, labelB) {
          const COL_ACC = "accountNo";
          const COL_BT = "billType";
          
          const accToRows = {};
          const accMatchesA = {};
          const accMatchesB = {};
          
          records.forEach(r => {
            const acc = ii(r[COL_ACC]);
            if (!acc) return;
            
            if (!accToRows[acc]) {
              accToRows[acc] = [];
              accMatchesA[acc] = false;
              accMatchesB[acc] = false;
            }
            accToRows[acc].push(r);
            
            const bt = String(r[COL_BT] || '').toLowerCase();
            
            for (let k of kw_a) {
              if (bt.includes(k.toLowerCase())) {
                accMatchesA[acc] = true;
                break;
              }
            }
            
            for (let k of kw_b) {
              if (bt.includes(k.toLowerCase())) {
                accMatchesB[acc] = true;
                break;
              }
            }
          });
          
          const flaggedAccs = [];
          Object.keys(accToRows).forEach(acc => {
            if (accMatchesA[acc] && accMatchesB[acc]) {
              flaggedAccs.push(acc);
            }
          });
          
          if (flaggedAccs.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: `✅ No ${checkName} conflicts detected`
            };
          }
          
          const flaggedRows = [];
          flaggedAccs.forEach(acc => {
            const rows = accToRows[acc];
            rows.forEach(r => {
              const formatted = formatOutputRow(r, `Conflict: ${checkName}`, desc);
              formatted.Why_Flagged = desc;
              formatted.AUDIT_ISSUE = desc;
              formatted.Risk_Score = 50;
              formatted.Duplicate_Group = acc;
              flaggedRows.push(formatted);
            });
          });
          
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          
          const totalAmount = flaggedRows.reduce((sum, r) => sum + r.Amount, 0);
          const uniqueNamesCount = new Set(flaggedRows.map(r => r.Beneficiary_Name)).size;
          
          return {
            data: flaggedRows,
            irregularFields: ["Account_No", "Bill_Type", "Amount"],
            findings: [
              { Metric: "Account Numbers", Value: flaggedAccs.length.toString() },
              { Metric: "Party Names", Value: uniqueNamesCount.toString() },
              { Metric: "Total Flagged Rows", Value: flaggedRows.length.toString() },
              { Metric: "Total Amount Involved", Value: `₹${formatIndianCurrency(totalAmount)}` }
            ],
            summary: `🚨 Found ${flaggedAccs.length} account(s) paid via both ${labelA} and ${labelB}`
          };
        }
        self.runConflictCheck = runConflictCheck;

        // 7. Migrated Legacy checks (DCRG, Medical, Holidays, FVC threshold, Cross-DDO)
        function run_dcrg_payments(records) {
          const COL_ACC = "accountNo";
          const COL_BT = "billType";
          const COL_DATE = "dateOfPayment";
          const COL_AMT = "amountPaid";
          const COL_NAME = "partyName";
          
          const accToRows = {};
          records.forEach(r => {
            const acc = ii(r[COL_ACC]);
            if (!acc) return;
            if (!accToRows[acc]) accToRows[acc] = [];
            accToRows[acc].push(r);
          });
          
          const dcrgAnchors = {};
          Object.keys(accToRows).forEach(acc => {
            const rows = accToRows[acc];
            let earliestDcrg = null;
            let earliestDate = null;
            
            rows.forEach(r => {
              const bt = String(r[COL_BT] || '').toUpperCase();
              const ref = String(r.billRefNo || '').toUpperCase();
              if (bt.includes("DCRG") || ref.includes("DCRG") || bt.includes("GRATUITY") || bt.includes("DCR ") || bt.includes("DEATH CUM RETIREMENT")) { // v2.3 FIX A-14
                const date = bc(r[COL_DATE]);
                if (date) {
                  if (!earliestDate || date < earliestDate) {
                    earliestDate = date;
                    earliestDcrg = r;
                  }
                }
              }
            });
            
            if (earliestDcrg) {
              dcrgAnchors[acc] = { record: earliestDcrg, date: earliestDate };
            }
          });
          
          const flaggedRecords = [];
          const findings = [];
          
          Object.keys(dcrgAnchors).forEach(acc => {
            const anchor = dcrgAnchors[acc];
            const rows = accToRows[acc];
            
            const subsequentPayments = [];
            rows.forEach(r => {
              const bt = String(r[COL_BT] || '').toUpperCase();
              const ref = String(r.billRefNo || '').toUpperCase();
              
              const isPension = bt.includes("PENSION") || bt.includes("PENS") || 
                                bt.includes("COMMUTATION") || bt.includes("COMM") ||
                                ref.includes("PENSION") || ref.includes("PENS") ||
                                ref.includes("COMMUTATION") || ref.includes("COMM");
              
              if (isPension) return;
              
              const date = bc(r[COL_DATE]);
              if (date && date > anchor.date) {
                subsequentPayments.push(r);
              }
            });
            
            if (subsequentPayments.length > 0) {
              const anchorFormatted = formatOutputRow(anchor.record, "ℹ️ DCRG ANCHOR", `DCRG Gratuity Anchor: Earliest DCRG payment on this account (${formatDate(anchor.record[COL_DATE])})`);
              anchorFormatted.Why_Flagged = `DCRG Gratuity Anchor: Earliest DCRG payment on this account (${formatDate(anchor.record[COL_DATE])})`;
              anchorFormatted.AUDIT_ISSUE = anchorFormatted.Why_Flagged;
              anchorFormatted.Risk_Score = 0;
              anchorFormatted.Duplicate_Group = acc;
              flaggedRecords.push(anchorFormatted);
              
              subsequentPayments.forEach(r => {
                const formatted = formatOutputRow(r, "Flagged: DCRG Payments", `Active ${r[COL_BT] || 'salary'} payment made on ${formatDate(r[COL_DATE])} after DCRG date (${formatDate(anchor.record[COL_DATE])}).`);
                formatted.Why_Flagged = `Active ${r[COL_BT] || 'salary'} payment made on ${formatDate(r[COL_DATE])} after DCRG date (${formatDate(anchor.record[COL_DATE])}).`;
                formatted.AUDIT_ISSUE = formatted.Why_Flagged;
                formatted.Risk_Score = 90;
                formatted.Duplicate_Group = acc;
                flaggedRecords.push(formatted);
              });
              
              const totalSubsequentAmount = subsequentPayments.reduce((sum, r) => sum + (r[COL_AMT] || 0), 0);
              
              findings.push({
                Account_No: acc,
                Beneficiary_Name: anchor.record[COL_NAME] || "Unknown",
                DCRG_Date: formatDate(anchor.record[COL_DATE]),
                Post_Death_Payments: subsequentPayments.length,
                Total_Amount: totalSubsequentAmount,
                Severity: "HIGH_RISK",
                Why_Flagged: `Account received ${subsequentPayments.length} active payment(s) after DCRG date (${formatDate(anchor.record[COL_DATE])})`
              });
            }
          });
          
          flaggedRecords.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          
          if (flaggedRecords.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "✅ No post-retirement/death salary anomalies detected"
            };
          }
          
          const totalAnomalies = flaggedRecords.filter(r => r.AUDIT_FLAG !== "ℹ️ DCRG ANCHOR").length;
          
          return {
            data: flaggedRecords,
            irregularFields: ["Account_No", "Date", "Amount"],
            findings: findings,
            summary: `🚨 HIGH RISK: ${findings.length} accounts flagged with active payments after DCRG gratuity (${totalAnomalies} records)`
          };
        }

        function run_medical_bills(records) {
          const COL_ACC = "accountNo";
          const COL_BT = "billType";
          const COL_AMT = "amountPaid";
          const COL_NAME = "partyName";
          
          const accToMedRows = {};
          records.forEach(r => {
            const acc = ii(r[COL_ACC]);
            if (!acc) return;
            
            const bt = String(r[COL_BT] || '').toLowerCase();
            if (bt.includes("medical") || bt.includes("med")) {
              if (!accToMedRows[acc]) {
                accToMedRows[acc] = [];
              }
              accToMedRows[acc].push(r);
            }
          });
          
          const flaggedRows = [];
          const findings = [];
          const flaggedAccs = [];
          
          Object.keys(accToMedRows).forEach(acc => {
            const rows = accToMedRows[acc];
            const count = rows.length;
            const total = rows.reduce((sum, r) => sum + (r[COL_AMT] || 0), 0);
            
            const hasMultiple = count > getSetting('medical_freq_limit', 1);
            const hasSubstantial = total >= getSetting('medical_amt_threshold', 50000);
            
            if (hasMultiple || hasSubstantial) {
              flaggedAccs.push(acc);
              
              let severity = "WARNING";
              let reason = "";
              if (hasMultiple && hasSubstantial) {
                severity = "HIGH_RISK";
                reason = `Multiple medical payments (${count}) totaling substantial amount (₹${formatIndianCurrency(total)})`;
              } else if (hasMultiple) {
                reason = `Multiple medical payments (${count}) totaling ₹${formatIndianCurrency(total)}`;
              } else {
                reason = `Substantial single medical payment of ₹${formatIndianCurrency(total)}`;
              }
              
              rows.forEach(r => {
                const formatted = formatOutputRow(r, "Flagged: Medical bills abnormal payments", reason);
                formatted.Why_Flagged = reason;
                formatted.AUDIT_ISSUE = reason;
                formatted.Risk_Score = severity === "HIGH_RISK" ? 80 : 50;
                flaggedRows.push(formatted);
              });
              
              findings.push({
                Account_No: acc,
                Beneficiary_Name: rows[0][COL_NAME] || "Unknown",
                Payment_Count: count,
                Total_Amount: total,
                Severity: severity,
                Why_Flagged: reason
              });
            }
          });
          
          if (flaggedRows.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "✅ No suspicious medical bill payments found"
            };
          }
          
          return {
            data: flaggedRows,
            irregularFields: ["Account_No", "Bill_Type", "Amount"],
            findings: findings,
            summary: `🚨 IRREGULAR: ${findings.length} accounts flagged for medical bill checks`
          };
        }

        function run_holiday_payments(records) {
          const COL_DATE = "dateOfPayment";
          
          const flaggedRecords = [];
          const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          
          records.forEach(r => {
            const dt = bc(r[COL_DATE]);
            if (!dt) return;
            
            const dayIdx = dt.getDay();
            const isWeekend = (dayIdx === 0 || dayIdx === 6);
            
            const year = dt.getFullYear();
            const monthStr = String(dt.getMonth() + 1).padStart(2, '0');
            const dayStr = String(dt.getDate()).padStart(2, '0');
            const yyyy_mm_dd = `${year}-${monthStr}-${dayStr}`;
            const mm_dd = `${monthStr}-${dayStr}`;
            
            let holidayName = null;
            if (YEAR_SPECIFIC_HOLIDAYS[yyyy_mm_dd]) {
              holidayName = YEAR_SPECIFIC_HOLIDAYS[yyyy_mm_dd];
            } else if (RECURRING_HOLIDAYS[mm_dd]) {
              holidayName = RECURRING_HOLIDAYS[mm_dd];
            }
            
            if (isWeekend || holidayName) {
              const dayName = daysOfWeek[dayIdx];
              const holidayLabel = holidayName || "Weekend";
              const why = holidayName ? `Payment on gazetted holiday: ${holidayName}` : `Payment on weekend (${dayName})`;
              
              const formatted = formatOutputRow(r, `Flagged: Payments of Holiday`, why);
              formatted.Day_of_Week = dayName;
              formatted.Holiday = holidayLabel;
              formatted.Why_Flagged = why;
              formatted.AUDIT_ISSUE = why;
              formatted.Risk_Score = holidayName ? 60 : 40;
              
              flaggedRecords.push(formatted);
            }
          });
          
          flaggedRecords.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          
          if (flaggedRecords.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "✅ No holiday/weekend payments found"
            };
          }
          
          flaggedRecords.sort((a, b) => {
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            return (dA ? dA.getTime() : 0) - (dB ? dB.getTime() : 0);
          });
          
          const hCount = flaggedRecords.filter(r => r.Holiday !== "Weekend").length;
          const wCount = flaggedRecords.filter(r => r.Holiday === "Weekend").length;
          
          const findings = flaggedRecords.slice(0, 50).map(r => ({
            Date: r.Date,
            Day: r.Day_of_Week,
            Holiday: r.Holiday,
            Amount: r.Amount,
            Severity: r.Holiday !== "Weekend" ? "IRREGULAR" : "WARNING"
          }));
          
          return {
            data: flaggedRecords,
            irregularFields: ["Date", "Day_of_Week", "Holiday"],
            findings: findings,
            summary: `🚨 ${hCount} holiday + ⚠️ ${wCount} weekend payments found`
          };
        }

        function run_fvc_below_threshold(records) {
          const COL_BT = "billType";
          const COL_AMT = "amountPaid";
          const COL_VOU = "voucherNo";
          
          const fvcThresholds = [
            { threshold: 20000, label: "₹20,000", note: "Local Purchase Limit" },
            { threshold: 50000, label: "₹50,000", note: "Quotation Purchase Limit" },
            { threshold: 250000, label: "₹2,50,000", note: "Tender Limit (Class-C)" },
            { threshold: 500000, label: "₹5,00,000", note: "Tender Limit (Class-B)" },
            { threshold: 1000000, label: "₹10,00,000", note: "Tender Limit (Class-A)" }
          ];
          
          const flaggedRecords = [];
          const findings = [];
          
          records.forEach(r => {
            const bt = String(r[COL_BT] || '').toLowerCase();
            if (!bt.includes("fvc") && !bt.includes("contingent")) return;
            
            const amt = Number(r[COL_AMT]);
            if (isNaN(amt) || amt <= 0) return;
            
            fvcThresholds.forEach(item => {
              const limit = item.threshold;
              const lowerBound = limit * (1 - getSetting('fvc_threshold_gap_pct', 2.0) / 100.0);
              
              if (amt >= lowerBound && amt < limit) {
                const gap = limit - amt;
                const gapPct = (gap / limit) * 100.0;
                
                const why = `Amount (₹${formatIndianCurrency(amt)}) within ${gapPct.toFixed(2)}% of threshold ${item.label} (${item.note})`;
                const severity = gapPct < 1.0 ? "HIGH_RISK" : "IRREGULAR";
                
                const formatted = formatOutputRow(r, "Flagged: FVC near approval limits (2%)", why);
                formatted.Threshold = item.label;
                formatted.Gap_Amount = gap;
                formatted.Gap_Percent = `${gapPct.toFixed(2)}%`;
                formatted.Threshold_Note = item.note;
                formatted.Why_Flagged = why;
                formatted.AUDIT_ISSUE = why;
                formatted.Risk_Score = gapPct < 1.0 ? 80 : 60;
                
                flaggedRecords.push(formatted);
                
                findings.push({
                  Voucher: r[COL_VOU] || "Unknown",
                  Amount: amt,
                  Threshold: item.label,
                  Gap: `₹${formatIndianCurrency(gap)}`,
                  Note: item.note,
                  Severity: severity
                });
              }
            });
          });
          
          flaggedRecords.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          
          if (flaggedRecords.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "✅ No FVC amounts near thresholds found"
            };
          }
          
          flaggedRecords.sort((a, b) => a.Gap_Amount - b.Gap_Amount);
          
          return {
            data: flaggedRecords,
            irregularFields: ["Amount", "Bill_Type", "Threshold", "Gap_Amount"],
            findings: findings.slice(0, 50),
            summary: `🚨 IRREGULAR: ${findings.length} FVC bills within 2% of procurement thresholds`
          };
        }

        function run_cross_ddo_payments(records) {
          const COL_ACC = "accountNo";
          const COL_DDO = "ddoCode";
          const COL_PCODE = "partyCode";
          const COL_NAME = "partyName";
          const COL_AMT = "amountPaid";
          
          const accGroups = {};
          records.forEach(r => {
            const acc = ii(r[COL_ACC]);
            if (!acc) return;
            
            if (!accGroups[acc]) {
              accGroups[acc] = [];
            }
            accGroups[acc].push(r);
          });
          
          const flaggedRecords = [];
          const findings = [];
          
          Object.keys(accGroups).forEach(acc => {
            const group = accGroups[acc];
            const uniqueDdos = new Set();
            const uniquePcodes = new Set();
            
            group.forEach(r => {
              const ddo = String(r[COL_DDO] || '').trim();
              if (ddo) uniqueDdos.add(ddo);
              
              const pcode = io(r[COL_PCODE]);
              if (pcode && pcode !== "0" && pcode !== "104" && pcode !== "NAN" && pcode !== "NONE") {
                uniquePcodes.add(pcode);
              }
            });
            
            if (uniqueDdos.size >= 2 && uniquePcodes.size > 1) {
              const severity = uniqueDdos.size > 3 ? "HIGH_RISK" : "WARNING";
              const riskScore = severity === "HIGH_RISK" ? 70 : 50;
              
              const ddoNamesSet = new Set(group.map(r => r.ddoName || r.DDO_Name).filter(Boolean));
              const ddoNames = Array.from(ddoNamesSet).slice(0, 3).join(" | ");
              
              const beneficiariesSet = new Set(group.map(r => r[COL_NAME]).filter(Boolean));
              const beneficiaries = Array.from(beneficiariesSet).slice(0, 3).join(" | ");
              
              const totalAmt = group.reduce((sum, r) => sum + (r[COL_AMT] || 0), 0);
              const ddosStr = Array.from(uniqueDdos).join(", ");
              const pcodesStr = Array.from(uniquePcodes).join(", ");
              
              findings.push({
                Account_No: acc,
                DDO_Count: uniqueDdos.size,
                DDO_Codes: ddosStr,
                DDO_Names: ddoNames,
                Beneficiaries: beneficiaries,
                Total_Amount: totalAmt,
                Payment_Count: group.length,
                Severity: severity,
                Risk_Score: riskScore
              });
              
              const reason = `Same account receiving from ${uniqueDdos.size} different DDOs with ${uniquePcodes.size} distinct Party Codes`;
              
              group.forEach(r => {
                const formatted = formatOutputRow(r, "Flagged: CROSS DDO PAYMENTS", reason);
                formatted.Cross_DDO_Count = uniqueDdos.size;
                formatted.All_DDOs = ddosStr;
                formatted.Why_Flagged = reason;
                formatted.AUDIT_ISSUE = reason;
                formatted.Risk_Score = riskScore;
                flaggedRecords.push(formatted);
              });
            }
          });
          
          flaggedRecords.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          
          if (flaggedRecords.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "✅ No cross-DDO payments to same account found"
            };
          }
          
          flaggedRecords.sort((a, b) => (a.Account_No < b.Account_No ? -1 : 1));
          
          return {
            data: flaggedRecords,
            irregularFields: ["Account_No", "DDO_Code", "DDO_Name"],
            findings: findings,
            summary: `🚨 CROSS DDO PAYMENTS: ${findings.length} accounts flagged`
          };
        }

        function run_flag_9(records) {
          const COL_ACC = "accountNo";
          const COL_BT = "billType";
          const COL_AMT = "amountPaid";
          const COL_NAME = "partyName";
          
          const accToRows = {};
          
          // v2.3 FIX A-12: GPF subscriptions are monthly — only flag if same account
          // has 2+ GPF rows in the SAME calendar month. Also expanded keywords.
          records.forEach(r => {
            const acc = ii(r[COL_ACC]);
            if (!acc) return;
            const bt = String(r[COL_BT] || '').trim().toUpperCase();
            const isGpf = bt.includes("DPF/GPF") || bt === "GPF" || bt === "DPF"
                       || bt.includes("PROVIDENT FUND") || bt.includes("GPF ADVANCE")
                       || bt.includes("DPF ADVANCE");
            if (!isGpf) return;
            const d = bc(r.dateOfPayment);
            const monthKey = d ? `${d.getFullYear()}-${d.getMonth()}` : "unknown";
            const monthAccKey = `${acc}|${monthKey}`;
            if (!accToRows[monthAccKey]) accToRows[monthAccKey] = [];
            accToRows[monthAccKey].push(r);
          });
          
          const flaggedAccs = [];
          Object.keys(accToRows).forEach(acc => {
            if (accToRows[acc].length >= 2) {
              flaggedAccs.push(acc);
            }
          });
          
          if (flaggedAccs.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "✅ No multiple DPF/GPF bills detected on same account"
            };
          }
          
          const flaggedRows = [];
          flaggedAccs.forEach(acc => {
            const rows = accToRows[acc];
            rows.forEach(r => {
              const formatted = formatOutputRow(r, "Flagged: Multiple DPF/GPF Bills", `Account received 2 or more DPF/GPF payments — possible duplicate GPF deduction`);
              formatted.Why_Flagged = `Account received 2 or more DPF/GPF payments — possible duplicate GPF deduction`;
              formatted.AUDIT_ISSUE = formatted.Why_Flagged;
              formatted.Risk_Score = 50;
              flaggedRows.push(formatted);
            });
          });
          
          flaggedRows.sort((a, b) => {
            if (a.Account_No !== b.Account_No) {
              return a.Account_No < b.Account_No ? -1 : 1;
            }
            return b.Amount - a.Amount;
          });
          
          const totalAmount = flaggedRows.reduce((sum, r) => sum + r.Amount, 0);
          const uniqueNamesCount = new Set(flaggedRows.map(r => r.Beneficiary_Name)).size;
          
          return {
            data: flaggedRows,
            irregularFields: ["Account_No", "Bill_Type", "Amount"],
            findings: [
              { Metric: "Flagged Accounts", Value: flaggedAccs.length.toString() },
              { Metric: "Party Names", Value: uniqueNamesCount.toString() },
              { Metric: "Total GPF/DPF Rows", Value: flaggedRows.length.toString() },
              { Metric: "Total Amount Involved", Value: `₹${formatIndianCurrency(totalAmount)}` }
            ],
            summary: `🚨 Found ${flaggedAccs.length} account(s) with 2+ DPF/GPF bills`
          };
        }

        // 13. Pay Bill Same Account Diff Party Check
        function run_flag_same_account_diff_party_paybill(records) {
          const COL_ACC = "accountNo";
          const COL_CODE = "partyCode";
          const COL_BILL_TYPE = "billType";
          
          const accToCodes = {};
          const accToRows = {};
          
          records.forEach(r => {
            const bt = String(r[COL_BILL_TYPE] || '').trim().toUpperCase();
            if (bt !== "PAY BILL" && !bt.includes("PAY BILL") && !bt.includes("PAY_BILL")) return;
            
            const acc = ii(r[COL_ACC]);
            const code = io(r[COL_CODE]);
            if (!acc || !code) return;
            
            if (!accToCodes[acc]) {
              accToCodes[acc] = new Set();
              accToRows[acc] = [];
            }
            accToCodes[acc].add(code);
            accToRows[acc].push(r);
          });
          
          const flaggedRows = [];
          const findings = [];
          let anomalyCount = 0;
          
          Object.entries(accToCodes).forEach(([acc, codesSet]) => {
            if (codesSet.size >= 2) { // v2.3 FIX: was incorrectly reusing fuzzy_name_freq_threshold
              anomalyCount++;
              const codesList = Array.from(codesSet);
              const rows = accToRows[acc];
              const totalAmt = rows.reduce((sum, r) => sum + (r.amountPaid || 0), 0);
              const reason = `Same bank account number (${acc}) received PAY BILL payments under ${codesSet.size} different party codes: ${codesList.join(', ')}`;
              
              rows.forEach(r => {
                const formatted = formatOutputRow(r, "🚨 WARNING", reason);
                formatted.Risk_Score = 65;
                formatted.Why_Flagged = reason;
                formatted.AUDIT_ISSUE = reason;
                formatted.Duplicate_Group = acc;
                flaggedRows.push(formatted);
              });
              
              findings.push({
                Account_No: acc,
                Party_Codes_Count: codesSet.size,
                Party_Codes: codesList.join(", "),
                Total_Amount: `₹${formatIndianCurrency(totalAmt)}`,
                Severity: "WARNING"
              });
            }
          });
          
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          findings.sort((a, b) => b.Party_Codes_Count - a.Party_Codes_Count);
          
          const summary = flaggedRows.length > 0
            ? `⚠️ WARNING: Found ${anomalyCount} accounts receiving Pay Bill payments under multiple party codes`
            : `✅ No duplicate account - different party codes found for Pay Bills`;
            
          return {
            data: flaggedRows,
            irregularFields: ["Account_No", "Party_Code"],
            findings: findings.slice(0, 50),
            summary: summary
          };
        }

        // 14. Duplicate Voucher Diff No Check (Excluding Pay Bills)
        function run_flag_duplicate_voucher_diff_no(records) {
          const COL_ACC = "accountNo";
          const COL_CODE = "partyCode";
          const COL_AMT = "amountPaid";
          const COL_VOU = "voucherNo";
          const COL_BILL_TYPE = "billType";
          
          const groups = {};
          records.forEach(r => {
            // Exclude PAY BILL transactions
            const bt = String(r[COL_BILL_TYPE] || '').trim().toUpperCase();
            if (bt === "PAY BILL" || bt.includes("PAY BILL") || bt.includes("PAY_BILL")) return;
            
            const acc = ii(r[COL_ACC]);
            const code = io(r[COL_CODE]);
            const amt = Number(r[COL_AMT] || 0);
            if (!acc || !code || amt <= 0) return;
            
            const key = `${acc}|${code}|${amt}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(r);
          });
          
          const flaggedRows = [];
          const findings = [];
          let duplicateGroupsCount = 0;
          
          Object.entries(groups).forEach(([key, rows]) => {
            if (rows.length < 2) return;
            
            const uniqueVouchers = new Set(rows.map(r => String(r[COL_VOU] || '').trim().toUpperCase()).filter(v => v !== ""));
            if (uniqueVouchers.size >= 2) {
              duplicateGroupsCount++;
              const [acc, code, amt] = key.split('|');
              const vouList = Array.from(uniqueVouchers);
              const totalAmt = rows.reduce((sum, r) => sum + (r.amountPaid || 0), 0);
              const reason = `Potential duplicate payment (excluding Pay Bills): Same account (${acc}), party (${code}), and amount (₹${formatIndianCurrency(Number(amt))}) paid via multiple different vouchers: ${vouList.join(', ')}`;
              
              rows.forEach(r => {
                const formatted = formatOutputRow(r, "🔴 HIGH_RISK", reason);
                formatted.Risk_Score = 85;
                formatted.Why_Flagged = reason;
                formatted.AUDIT_ISSUE = reason;
                flaggedRows.push(formatted);
              });
              
              findings.push({
                Account_No: acc,
                Party_Code: code,
                Amount: Number(amt),
                Vouchers_Count: rows.length,
                Vouchers: vouList.join(", "),
                Total_Paid: `₹${formatIndianCurrency(totalAmt)}`,
                Severity: "HIGH_RISK"
              });
            }
          });
          
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          findings.sort((a, b) => b.Amount - a.Amount);
          
          const summary = flaggedRows.length > 0
            ? `🔴 HIGH RISK: Found ${duplicateGroupsCount} cases of duplicate payments (excluding Pay Bills) with different voucher numbers`
            : `✅ No duplicate vouchers (excluding Pay Bills) detected`;
            
          return {
            data: flaggedRows,
            irregularFields: ["Account_No", "Party_Code", "Amount", "Vou_No"],
            findings: findings.slice(0, 50),
            summary: summary
          };
        }


        // ═══════════════════════════════════════════════════════════════
        // VERSION 2.3 — NEW CHECKS (B-8 through B-12)
        // ═══════════════════════════════════════════════════════════════

        // B-8: Year-End New Account Injection (March Rush)
        // Accounts whose FIRST-EVER payment appears in March — classic budget exhaustion fraud.
        function run_flag_march_rush_new_account(records) {
          const accFirst = {};
          const accItems = {};

          records.forEach(r => {
            const acc = ii(r.accountNo);
            if (!acc) return;
            const d = bc(r.dateOfPayment);
            if (!d) return;
            if (!accFirst[acc] || d < accFirst[acc]) accFirst[acc] = d;
            if (!accItems[acc]) accItems[acc] = [];
            accItems[acc].push({ record: r, date: d });
          });

          const minAmt = getSetting('march_new_account_limit', 50000);
          const flaggedRows = [];
          const findings = [];
          let count = 0;

          Object.entries(accFirst).forEach(([acc, firstDate]) => {
            if (firstDate.getMonth() !== 2) return; // month 2 = March (0-indexed)
            const marchItems = accItems[acc].filter(x => x.date.getMonth() === 2);
            const marchTotal = marchItems.reduce((s, x) => s + (x.record.amountPaid || 0), 0);
            if (marchTotal < minAmt) return;

            count++;
            const risk     = marchTotal >= 100000 ? 90 : 75;
            const severity = marchTotal >= 100000 ? 'HIGH_RISK' : 'WARNING';
            const reason   = `Account (${acc}) first-ever payment appears in March — ₹${formatIndianCurrency(marchTotal)} across ${marchItems.length} payment(s). Possible year-end budget exhaustion.`;

            marchItems.forEach(x => {
              const fmt = formatOutputRow(x.record, 'Flagged: March Rush New Account', reason);
              fmt.Risk_Score = risk; fmt.Why_Flagged = reason; fmt.AUDIT_ISSUE = reason;
              fmt.Duplicate_Group = acc;
              flaggedRows.push(fmt);
            });
            findings.push({
              Account_No: acc,
              First_Payment_Date: formatDate(firstDate),
              March_Total: `₹${formatIndianCurrency(marchTotal)}`,
              Payment_Count: marchItems.length,
              Severity: severity,
              Risk_Score: risk
            });
          });

          flaggedRows.sort((a, b) => b.Risk_Score - a.Risk_Score);
          findings.sort((a, b) => b.Risk_Score - a.Risk_Score);

          return {
            data: flaggedRows.slice(0, 500),
            irregularFields: ['Account_No', 'Date', 'Amount'],
            findings: findings.slice(0, 50),
            summary: count > 0
              ? `⚠️ WARNING: ${count} accounts whose first-ever payment is in March (year-end injection risk) ≥ ₹${formatIndianCurrency(minAmt)}`
              : `✅ No suspicious year-end new account injections detected`
          };
        }

        // B-9: Annual Vendor Cap per DDO
        // Flags vendor-DDO pairs exceeding cumulative annual payment threshold.
        function run_flag_annual_vendor_cap(records) {
          const groups = {};
          records.forEach(r => {
            const ddo   = String(r.ddoCode || r.DDO_Code || '').trim();
            const party = io(r.partyCode);
            const d     = bc(r.dateOfPayment);
            if (!ddo || !party || !d) return;
            const fy  = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
            const key = `${ddo}|${party}|${fy}`;
            if (!groups[key]) groups[key] = { records: [], total: 0, ddo, party, fy, name: r.partyName || '' };
            groups[key].records.push(r);
            groups[key].total += Number(r.amountPaid || 0);
          });

          const cap      = getSetting('annual_vendor_ddo_cap', 1000000);
          const minCount = getSetting('annual_vendor_min_count', 5);
          const flaggedRows = [];
          const findings    = [];
          let count = 0;

          Object.entries(groups).forEach(([key, grp]) => {
            if (grp.total < cap || grp.records.length < minCount) return;
            count++;
            const risk   = grp.total >= cap * 3 ? 85 : 65;
            const reason = `Vendor (${grp.party}) received cumulative ₹${formatIndianCurrency(grp.total)} from DDO ${grp.ddo} in FY${grp.fy}-${grp.fy + 1} (${grp.records.length} payments) — exceeds annual vendor threshold of ₹${formatIndianCurrency(cap)}`;
            grp.records.forEach(r => {
              const fmt = formatOutputRow(r, 'Flagged: Annual Vendor Cap Exceeded', reason);
              fmt.Risk_Score = risk; fmt.Why_Flagged = reason; fmt.AUDIT_ISSUE = reason;
              fmt.Duplicate_Group = key;
              flaggedRows.push(fmt);
            });
            findings.push({
              DDO_Code: grp.ddo, Party_Code: grp.party, Beneficiary_Name: grp.name,
              Financial_Year: `${grp.fy}-${grp.fy + 1}`,
              Total_Amount: `₹${formatIndianCurrency(grp.total)}`,
              Payment_Count: grp.records.length,
              Cap_Threshold: `₹${formatIndianCurrency(cap)}`,
              Severity: risk >= 85 ? 'HIGH_RISK' : 'WARNING',
              Risk_Score: risk
            });
          });

          flaggedRows.sort((a, b) => b.Risk_Score - a.Risk_Score);
          findings.sort((a, b) => {
            const va = parseFloat(String(a.Total_Amount).replace(/[^0-9.]/g, '')) || 0;
            const vb = parseFloat(String(b.Total_Amount).replace(/[^0-9.]/g, '')) || 0;
            return vb - va;
          });

          return {
            data: flaggedRows.slice(0, 1000),
            irregularFields: ['Party_Code', 'DDO_Code', 'Amount'],
            findings: findings.slice(0, 50),
            summary: count > 0
              ? `⚠️ WARNING: ${count} vendor-DDO combinations exceeded annual cap of ₹${formatIndianCurrency(cap)}`
              : `✅ No vendor-DDO combinations exceeded the annual payment cap of ₹${formatIndianCurrency(cap)}`
          };
        }

        // B-10: Beneficiary Name Sanity Check (Test / Dummy / Placeholder Accounts)
        function run_flag_suspicious_names(records) {
          const PATTERNS = [
            { re: /\bTEST\b/i,   label: 'Name contains TEST' },
            { re: /\bDUMMY\b/i,  label: 'Name contains DUMMY' },
            { re: /\bTEMP\b/i,   label: 'Name contains TEMP' },
            { re: /\bNULL\b/i,   label: 'Name is NULL' },
            { re: /\bXXXX/i,      label: 'Name contains XXXX placeholder' },
            { re: /\bSAMPLE\b/i, label: 'Name contains SAMPLE' },
            { re: /^[0-9\s]+$/,   label: 'Name is purely numeric' },
            { re: /^[-_\s.]+$/,   label: 'Name contains only special characters' },
          ];

          const flaggedRows = [];
          const findings    = [];

          records.forEach(r => {
            const name = String(r.partyName || r.Beneficiary_Name || '').trim();
            if (!name || name.length < 2) return;
            for (const { re, label } of PATTERNS) {
              if (re.test(name)) {
                const amt    = Number(r.amountPaid || 0);
                const reason = `Beneficiary name "${name}" matches suspicious pattern — ${label}. Possible test/dummy record in live data.`;
                const fmt    = formatOutputRow(r, 'Flagged: Suspicious Beneficiary Name', reason);
                fmt.Risk_Score = 70; fmt.Why_Flagged = reason; fmt.AUDIT_ISSUE = reason;
                flaggedRows.push(fmt);
                findings.push({
                  Beneficiary_Name: name,
                  Pattern: label,
                  Amount: `₹${formatIndianCurrency(amt)}`,
                  Voucher: r.voucherNo || '',
                  Severity: 'WARNING',
                  Risk_Score: 70
                });
                break;
              }
            }
          });

          return {
            data: flaggedRows.slice(0, 500),
            irregularFields: ['Beneficiary_Name'],
            findings: findings.slice(0, 50),
            summary: flaggedRows.length > 0
              ? `⚠️ WARNING: ${flaggedRows.length} records with suspicious beneficiary names (test/dummy/placeholder)`
              : `✅ No suspicious beneficiary names detected`
          };
        }

        // B-11: Salary Jump Detection (Month-on-Month)
        // PAY BILL amount changes >30% between consecutive months without an ARREAR/ADVANCE bill.
        function run_flag_salary_jump(records) {
          const accMonths = {};
          records.forEach(r => {
            if (!isPayBillRow(r)) return;
            const bt = String(r.billType || '').trim().toUpperCase();
            if (bt.includes('ARREAR') || bt.includes('ADVANCE')) return;
            const acc = ii(r.accountNo);
            if (!acc) return;
            const d = bc(r.dateOfPayment);
            if (!d) return;
            const fy  = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
            const fym = d.getMonth() >= 3 ? d.getMonth() - 3 : d.getMonth() + 9; // 0=Apr
            const sk  = fy * 12 + fym;
            if (!accMonths[acc]) accMonths[acc] = [];
            accMonths[acc].push({ sk, amt: Number(r.amountPaid || 0), record: r });
          });

          const threshold  = getSetting('salary_jump_pct', 0.30);
          const flaggedRows = [];
          const findings    = [];
          let count = 0;

          Object.entries(accMonths).forEach(([acc, entries]) => {
            if (entries.length < 2) return;
            entries.sort((a, b) => a.sk - b.sk);
            for (let i = 1; i < entries.length; i++) {
              if (entries[i].sk - entries[i-1].sk !== 1) continue; // must be consecutive months
              if (entries[i-1].amt <= 0) continue;
              const chg = (entries[i].amt - entries[i-1].amt) / entries[i-1].amt;
              if (Math.abs(chg) <= threshold) continue;
              count++;
              const dir    = chg > 0 ? 'INCREASE' : 'DECREASE';
              const risk   = Math.abs(chg) > 0.50 ? 85 : 70;
              const reason = `PAY BILL ${dir} of ${(Math.abs(chg)*100).toFixed(1)}% between consecutive months for account ${acc}: ₹${formatIndianCurrency(entries[i-1].amt)} → ₹${formatIndianCurrency(entries[i].amt)}`;
              [entries[i-1], entries[i]].forEach(e => {
                const fmt = formatOutputRow(e.record, 'Flagged: Salary Jump', reason);
                fmt.Risk_Score = risk; fmt.Why_Flagged = reason; fmt.AUDIT_ISSUE = reason;
                fmt.Duplicate_Group = acc;
                flaggedRows.push(fmt);
              });
              findings.push({
                Account_No: acc,
                Prev_Amount: `₹${formatIndianCurrency(entries[i-1].amt)}`,
                New_Amount: `₹${formatIndianCurrency(entries[i].amt)}`,
                Change_Pct: `${(chg*100).toFixed(1)}%`,
                Direction: dir,
                Severity: risk >= 85 ? 'HIGH_RISK' : 'WARNING',
                Risk_Score: risk
              });
            }
          });

          flaggedRows.sort((a, b) => b.Risk_Score - a.Risk_Score);
          findings.sort((a, b) => Math.abs(parseFloat(b.Change_Pct)) - Math.abs(parseFloat(a.Change_Pct)));

          return {
            data: flaggedRows.slice(0, 500),
            irregularFields: ['Account_No', 'Amount', 'Date'],
            findings: findings.slice(0, 50),
            summary: count > 0
              ? `⚠️ WARNING: ${count} accounts with salary jumps exceeding ${(threshold*100).toFixed(0)}% between consecutive months`
              : `✅ No anomalous salary jumps detected (threshold: ${(threshold*100).toFixed(0)}%)`
          };
        }

        // B-12: DDO Year-End Budget Exhaustion (March Rush by DDO)
        // Flags DDOs spending >40% of annual payments in the last 15 days of March.
        function run_flag_ddo_march_rush(records) {
          const ddoFY = {};
          records.forEach(r => {
            const ddo = String(r.ddoCode || r.DDO_Code || '').trim();
            if (!ddo) return;
            const d   = bc(r.dateOfPayment);
            if (!d) return;
            const amt = Number(r.amountPaid || 0);
            if (amt <= 0) return;
            const fy  = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
            const key = `${ddo}|${fy}`;
            if (!ddoFY[key]) ddoFY[key] = { ddo, fy, ddoName: r.ddoName || r.DDO_Name || '', total: 0, rush: 0, rushRecs: [] };
            ddoFY[key].total += amt;
            if (d.getMonth() === 2 && d.getDate() >= 16) { // last 15 days of March
              ddoFY[key].rush += amt;
              ddoFY[key].rushRecs.push(r);
            }
          });

          const rushPct = getSetting('march_rush_pct', 0.40);
          const flaggedRows = [];
          const findings    = [];
          let count = 0;

          Object.entries(ddoFY).forEach(([key, g]) => {
            if (g.total <= 0 || g.rush <= 0) return;
            const ratio = g.rush / g.total;
            if (ratio < rushPct) return;
            count++;
            const risk     = ratio >= 0.70 ? 90 : (ratio >= 0.55 ? 75 : 60);
            const severity = risk >= 90 ? 'HIGH_RISK' : (risk >= 75 ? 'WARNING' : 'REVIEW');
            const reason   = `DDO ${g.ddo} spent ${(ratio*100).toFixed(1)}% of FY${g.fy}-${g.fy+1} payments (₹${formatIndianCurrency(g.rush)} of ₹${formatIndianCurrency(g.total)}) in last 15 days of March — budget exhaustion risk`;
            g.rushRecs.forEach(r => {
              const fmt = formatOutputRow(r, 'Flagged: DDO March Rush', reason);
              fmt.Risk_Score = risk; fmt.Why_Flagged = reason; fmt.AUDIT_ISSUE = reason;
              fmt.Duplicate_Group = key;
              flaggedRows.push(fmt);
            });
            findings.push({
              DDO_Code: g.ddo,
              DDO_Name: g.ddoName,
              Financial_Year: `${g.fy}-${g.fy+1}`,
              Annual_Total: `₹${formatIndianCurrency(g.total)}`,
              March_Rush_Amt: `₹${formatIndianCurrency(g.rush)}`,
              Rush_Pct: `${(ratio*100).toFixed(1)}%`,
              Rush_Payments: g.rushRecs.length,
              Severity: severity,
              Risk_Score: risk
            });
          });

          flaggedRows.sort((a, b) => b.Risk_Score - a.Risk_Score);
          findings.sort((a, b) => parseFloat(b.Rush_Pct) - parseFloat(a.Rush_Pct));

          return {
            data: flaggedRows.slice(0, 1000),
            irregularFields: ['DDO_Code', 'Amount', 'Date'],
            findings: findings.slice(0, 50),
            summary: count > 0
              ? `⚠️ WARNING: ${count} DDOs spent ≥${(rushPct*100).toFixed(0)}% of annual payments in last 15 days of March (budget exhaustion)`
              : `✅ No DDO budget exhaustion patterns detected (threshold: ≥${(rushPct*100).toFixed(0)}% in last 15 days of March)`
          };
        }


        // ─────────────────────────────────────────────────────────────────
        // B-13: Payment Day-of-Week Concentration (Batch Manipulation Signal)
        // Flags DDOs where an unusual % of payments land on a single weekday.
        // ─────────────────────────────────────────────────────────────────
        function run_flag_dow_concentration(records) {
          const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const ddoStats = {};

          records.forEach(r => {
            const ddo = String(r.ddoCode || r.DDO_Code || '').trim();
            if (!ddo) return;
            const d = bc(r.dateOfPayment);
            if (!d) return;
            if (!ddoStats[ddo]) {
              ddoStats[ddo] = { total: 0, days: [0,0,0,0,0,0,0], ddoName: r.ddoName || r.DDO_Name || '', records: [] };
            }
            ddoStats[ddo].total++;
            ddoStats[ddo].days[d.getDay()]++;
            ddoStats[ddo].records.push(r);
          });

          const minCount  = getSetting('dow_min_payments', 50);
          const threshold = getSetting('dow_concentration_pct', 60) / 100;
          const flaggedRows = [];
          const findings   = [];

          Object.entries(ddoStats).forEach(([ddo, stat]) => {
            if (stat.total < minCount) return;
            const maxDay  = stat.days.indexOf(Math.max(...stat.days));
            const maxPct  = stat.days[maxDay] / stat.total;
            if (maxPct < threshold) return;

            const risk     = maxPct >= 0.80 ? 65 : 45;
            const severity = risk >= 65 ? 'WARNING' : 'REVIEW';
            const dayName  = DAY_NAMES[maxDay];
            const reason   = `DDO ${ddo}: ${(maxPct * 100).toFixed(1)}% of ${stat.total} payments fall on ${dayName}s — possible batch manipulation pattern`;

            stat.records.filter(r => {
              const d = bc(r.dateOfPayment);
              return d && d.getDay() === maxDay;
            }).slice(0, 200).forEach(r => {
              const fmt = formatOutputRow(r, 'Flagged: DOW Concentration', reason);
              fmt.Risk_Score  = risk;
              fmt.Why_Flagged = reason;
              fmt.AUDIT_ISSUE = reason;
              fmt.Peak_Day    = dayName;
              fmt.Duplicate_Group = ddo;
              flaggedRows.push(fmt);
            });

            findings.push({
              DDO_Code:      ddo,
              DDO_Name:      stat.ddoName,
              Peak_Day:      dayName,
              Peak_Day_Pct:  `${(maxPct * 100).toFixed(1)}%`,
              Peak_Day_Count: stat.days[maxDay],
              Total_Payments: stat.total,
              Severity:      severity,
              Risk_Score:    risk
            });
          });

          flaggedRows.sort((a, b) => b.Risk_Score - a.Risk_Score);
          findings.sort((a, b) => parseFloat(b.Peak_Day_Pct) - parseFloat(a.Peak_Day_Pct));

          return {
            data: flaggedRows.slice(0, 500),
            irregularFields: ['DDO_Code', 'Date', 'Peak_Day'],
            findings: findings.slice(0, 50),
            summary: findings.length > 0
              ? `⚠️ WARNING: ${findings.length} DDO(s) show unusual day-of-week payment concentration (≥${getSetting('dow_concentration_pct', 60)}%)`
              : `✅ No unusual day-of-week concentration detected (threshold: ${getSetting('dow_concentration_pct', 60)}%)`
          };
        }


// ═══════════════════════════════════════════════════════════════════════
// v2.4 TRIAGE & CONVERGENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

// Helper: safely run a check, return [] on error
function _safeRun(fn, records) {
  try {
    const r = fn(records);
    return (r && Array.isArray(r.data)) ? r.data : [];
  } catch(e) {
    return [];
  }
}

// T-1: Top Accounts Triage — multi-check convergence aggregation
// Returns top-100 accounts flagged by ≥2 independent checks
function run_triage_top_accounts(records) {
  const CHECKS = [
    { key: "cross_ddo_same_account",    fn: run_cross_ddo_payments },
    { key: "rapid_payments",            fn: run_flag_rapid_payments },
    { key: "salary_jump",               fn: run_flag_salary_jump },
    { key: "march_rush_new_account",    fn: run_flag_march_rush_new_account },
    { key: "annual_vendor_cap",         fn: run_flag_annual_vendor_cap },
    { key: "suspicious_names",          fn: run_flag_suspicious_names },
    { key: "post_death_payments",       fn: run_dcrg_payments },
    { key: "paybill_dup_monthly",       fn: run_flag_paybill_duplicate_monthly },
    { key: "split_billing",             fn: run_flag_split_billing },
    { key: "inactive_reactivation",     fn: run_flag_inactive_reactivation },
    { key: "same_day",                  fn: run_flag_same_day },
    { key: "near_approval_limits",      fn: run_flag_approval_limits },
    { key: "round_amounts",             fn: run_flag_round_amounts },
    { key: "ddo_march_rush",            fn: run_flag_ddo_march_rush },
    { key: "paybill_high_value",        fn: run_flag_29_high_paybill }
  ];

  const acctMap = new Map();

  CHECKS.forEach(({ key, fn }) => {
    const rows = _safeRun(fn, records);
    rows.forEach(row => {
      const acct = row.Account_No || "";
      if (!acct) return;
      if (!acctMap.has(acct)) {
        acctMap.set(acct, {
          Account_No: acct,
          Beneficiary_Name: row.Beneficiary_Name || "",
          DDO_Code: row.DDO_Code || "",
          DDO_Name: row.DDO_Name || "",
          IFSC: row.IFSC || "",
          checks_hit: new Set(),
          risk_total: 0,
          flagged_amount: 0,
          vouchers: new Set()
        });
      }
      const e = acctMap.get(acct);
      e.checks_hit.add(key);
      e.risk_total += (Number(row.Risk_Score) || 50);
      e.flagged_amount += (Number(row.Amount) || 0);
      if (row.Vou_No) e.vouchers.add(String(row.Vou_No));
    });
  });

  const rows = [];
  acctMap.forEach(e => {
    const fc = e.checks_hit.size;
    if (fc < 2) return;
    const score = Math.min(100, Math.round((e.risk_total / Math.max(fc, 1)) * (1 + fc * 0.08)));
    let action = "MANUAL REVIEW";
    if (fc >= 5 || score >= 85)       action = "🔴 HIGH PRIORITY — Physical Verification";
    else if (fc >= 4 || score >= 70)  action = "🟠 VOUCHER CHECK REQUIRED";
    else if (fc >= 3 || score >= 55)  action = "🟡 DETAILED REVIEW";
    rows.push({
      Account_No:           e.Account_No,
      Beneficiary_Name:     e.Beneficiary_Name,
      DDO_Code:             e.DDO_Code,
      DDO_Name:             e.DDO_Name,
      IFSC:                 e.IFSC,
      Flags_Hit:            fc,
      Flag_Names:           [...e.checks_hit].join(" | "),
      Total_Risk_Score:     score,
      Total_Flagged_Amount: e.flagged_amount,
      Vouchers_To_Check:    [...e.vouchers].slice(0, 15).join(", "),
      Recommended_Action:   action,
      Risk_Score:           score,
      AUDIT_FLAG:           score >= 75 ? "IRREGULAR" : score >= 55 ? "WARNING" : "REVIEW",
      Why_Flagged:          `Multi-check convergence: ${fc} checks flagged this account`,
      AUDIT_ISSUE:          `Account flagged by ${fc} independent audit checks (risk score ${score}/100). Checks: ${[...e.checks_hit].join(", ")}.  Total flagged: ₹${formatIndianCurrency(e.flagged_amount)}`
    });
  });

  rows.sort((a, b) => b.Flags_Hit - a.Flags_Hit || b.Total_Risk_Score - a.Total_Risk_Score);
  const top = rows.slice(0, 100);
  const hp = top.filter(r => r.Flags_Hit >= 4).length;

  return {
    data: top,
    irregularFields: ["Account_No", "Flags_Hit", "Total_Risk_Score", "Recommended_Action"],
    findings: [
      { Metric: "Accounts with ≥2 Check Flags", Value: rows.length.toString() },
      { Metric: "HIGH PRIORITY (≥4 flags)",      Value: hp.toString() },
      { Metric: "Showing Top",                   Value: `${top.length} accounts` }
    ],
    summary: rows.length > 0
      ? `🎯 TRIAGE: ${rows.length} accounts flagged by ≥2 independent checks. ${hp} HIGH PRIORITY. Review this list first.`
      : `✅ No accounts flagged by 2+ independent checks simultaneously`
  };
}

// T-2: Voucher Clustering — group flagged payment lines by voucher number
function run_voucher_clustering(records) {
  const CHECKS = [
    { key: "cross_ddo_same_account", fn: run_cross_ddo_payments },
    { key: "rapid_payments",         fn: run_flag_rapid_payments },
    { key: "salary_jump",            fn: run_flag_salary_jump },
    { key: "march_rush_new_account", fn: run_flag_march_rush_new_account },
    { key: "annual_vendor_cap",      fn: run_flag_annual_vendor_cap },
    { key: "post_death_payments",    fn: run_dcrg_payments },
    { key: "paybill_dup_monthly",    fn: run_flag_paybill_duplicate_monthly },
    { key: "split_billing",          fn: run_flag_split_billing },
    { key: "round_amounts",          fn: run_flag_round_amounts },
    { key: "near_approval_limits",   fn: run_flag_approval_limits },
    { key: "dup_amt_party",          fn: run_flag_4 }
  ];

  const vMap = new Map();

  CHECKS.forEach(({ key, fn }) => {
    const rows = _safeRun(fn, records);
    rows.forEach(row => {
      const vou = String(row.Vou_No || row.Raw_Voucher_Number || "").trim();
      if (!vou || vou === "0" || vou === "") return;
      if (!vMap.has(vou)) {
        vMap.set(vou, {
          Voucher_No: vou,
          DDO_Code:   row.DDO_Code || "",
          DDO_Name:   row.DDO_Name || "",
          Month:      row.Month || "",
          Year:       row.Year || "",
          checks_hit: new Set(),
          lines:      0,
          total_amt:  0,
          accounts:   new Set(),
          risk_max:   0
        });
      }
      const e = vMap.get(vou);
      e.checks_hit.add(key);
      e.lines++;
      e.total_amt += (Number(row.Amount) || 0);
      if (row.Account_No) e.accounts.add(row.Account_No);
      e.risk_max = Math.max(e.risk_max, Number(row.Risk_Score) || 0);
    });
  });

  const rows = [];
  vMap.forEach(e => {
    const score = e.risk_max;
    rows.push({
      Voucher_No:           e.Voucher_No,
      DDO_Code:             e.DDO_Code,
      DDO_Name:             e.DDO_Name,
      Month:                e.Month,
      Year:                 e.Year,
      Flagged_Lines:        e.lines,
      Distinct_Checks:      e.checks_hit.size,
      Flag_Names:           [...e.checks_hit].join(" | "),
      Unique_Accounts:      e.accounts.size,
      Total_Flagged_Amount: e.total_amt,
      Max_Risk_Score:       score,
      Risk_Score:           score,
      AUDIT_FLAG:           score >= 75 ? "IRREGULAR" : score >= 55 ? "WARNING" : "REVIEW",
      Why_Flagged:          `Voucher has ${e.lines} flagged lines across ${e.checks_hit.size} audit checks`,
      AUDIT_ISSUE:          `Voucher ${e.Voucher_No} has ${e.lines} flagged payment lines (${e.accounts.size} accounts) from checks: ${[...e.checks_hit].join(", ")}`
    });
  });

  rows.sort((a, b) => b.Flagged_Lines - a.Flagged_Lines || b.Max_Risk_Score - a.Max_Risk_Score);
  const top = rows.slice(0, 100);

  return {
    data: top,
    irregularFields: ["Voucher_No", "Flagged_Lines", "Distinct_Checks"],
    findings: [
      { Metric: "Vouchers with Flagged Lines",      Value: rows.length.toString() },
      { Metric: "Multi-Check Vouchers (≥2 checks)", Value: rows.filter(v => v.Distinct_Checks >= 2).length.toString() },
      { Metric: "Showing Top",                      Value: `${top.length} vouchers` }
    ],
    summary: rows.length > 0
      ? `📋 VOUCHER CLUSTERS: ${rows.length} vouchers have flagged payment lines. Top: ${top[0]?.Flagged_Lines || 0} flagged lines in voucher ${top[0]?.Voucher_No || "N/A"}.`
      : `✅ No vouchers with multiple flagged lines detected`
  };
}

// T-3: Ghost Employee Composite Score
function run_ghost_employee_composite(records) {
  const SIGNALS = [
    { key: "cross_ddo",          fn: run_cross_ddo_payments,         w: 25, label: "Cross-DDO payments (multiple DDOs paying same account)" },
    { key: "post_death",         fn: run_dcrg_payments,              w: 40, label: "Post-death/retirement salary continues after DCRG" },
    { key: "dormant",            fn: run_flag_inactive_reactivation, w: 20, label: "Dormant account reactivated" },
    { key: "march_new",          fn: run_flag_march_rush_new_account,w: 15, label: "New account first payment in March" },
    { key: "suspicious_name",    fn: run_flag_suspicious_names,      w: 20, label: "Suspicious/test beneficiary name" },
    { key: "salary_jump",        fn: run_flag_salary_jump,           w: 15, label: "Abnormal salary jump >30% without arrear" }
  ];

  const acctMap = new Map();

  SIGNALS.forEach(({ key, fn, w, label }) => {
    const rows = _safeRun(fn, records);
    rows.forEach(row => {
      const acct = row.Account_No || "";
      if (!acct) return;
      if (!acctMap.has(acct)) {
        acctMap.set(acct, {
          Account_No: acct, Beneficiary_Name: row.Beneficiary_Name || "",
          DDO_Code: row.DDO_Code || "", DDO_Name: row.DDO_Name || "",
          ghost_score: 0, signals: [], total_amt: 0, vouchers: new Set()
        });
      }
      const e = acctMap.get(acct);
      if (!e.signals.includes(label)) { e.ghost_score += w; e.signals.push(label); }
      e.total_amt += (Number(row.Amount) || 0);
      if (row.Vou_No) e.vouchers.add(String(row.Vou_No));
    });
  });

  const rows = [];
  acctMap.forEach(e => {
    const score = Math.min(100, e.ghost_score);
    if (score < 45) return;
    rows.push({
      Account_No: e.Account_No, Beneficiary_Name: e.Beneficiary_Name,
      DDO_Code: e.DDO_Code, DDO_Name: e.DDO_Name,
      Ghost_Score: score, Signal_Count: e.signals.length,
      Signals_Detected: e.signals.join(" | "),
      Total_Amount_Involved: e.total_amt,
      Vouchers_To_Check: [...e.vouchers].slice(0, 10).join(", "),
      Risk_Score: score,
      AUDIT_FLAG:   score >= 70 ? "IRREGULAR" : "WARNING",
      Why_Flagged:  `Ghost Employee Score: ${score}/100 — ${e.signals.length} signals`,
      AUDIT_ISSUE:  `Composite ghost employee analysis (score ${score}/100): ${e.signals.join("; ")}. Total flagged: ₹${formatIndianCurrency(e.total_amt)}`
    });
  });

  rows.sort((a, b) => b.Ghost_Score - a.Ghost_Score);
  const top = rows.slice(0, 50);

  return {
    data: top,
    irregularFields: ["Account_No", "Ghost_Score", "Signal_Count"],
    findings: [
      { Metric: "Accounts with Ghost Score ≥45", Value: rows.length.toString() },
      { Metric: "High Risk (Score ≥70)",         Value: rows.filter(r => r.Ghost_Score >= 70).length.toString() },
      { Metric: "Showing Top",                   Value: `${top.length} accounts` }
    ],
    summary: rows.length > 0
      ? `👻 GHOST EMPLOYEE: ${rows.length} accounts with composite ghost score ≥45. Top score: ${top[0]?.Ghost_Score || 0}/100 (${top[0]?.Beneficiary_Name || ""})`
      : `✅ No accounts show composite ghost employee indicators`
  };
}

// T-4: Vendor Fraud Composite Score
function run_vendor_fraud_composite(records) {
  const SIGNALS = [
    { fn: run_flag_split_billing,             w: 25, label: "Split billing near approval threshold" },
    { fn: run_flag_rapid_payments,            w: 20, label: "Rapid succession payments (burst)" },
    { fn: run_flag_annual_vendor_cap,         w: 30, label: "Annual vendor cap breach" },
    { fn: run_flag_round_amounts,             w: 10, label: "Suspiciously round payment amounts" },
    { fn: run_flag_suspicious_names,          w: 25, label: "Suspicious/test vendor name" },
    { fn: run_flag_approval_limits,           w: 15, label: "Payments clustered below approval limits" }
  ];

  const vMap = new Map();

  SIGNALS.forEach(({ fn, w, label }) => {
    const rows = _safeRun(fn, records);
    rows.forEach(row => {
      const vkey = `${row.Party_Code || row.Account_No || ""}|${row.DDO_Code || ""}`;
      if (!vkey || vkey === "|") return;
      if (!vMap.has(vkey)) {
        vMap.set(vkey, {
          Account_No: row.Account_No || "", Party_Code: row.Party_Code || "",
          Beneficiary_Name: row.Beneficiary_Name || "",
          DDO_Code: row.DDO_Code || "", DDO_Name: row.DDO_Name || "",
          vendor_score: 0, signals: [], total_amt: 0, count: 0, vouchers: new Set()
        });
      }
      const e = vMap.get(vkey);
      if (!e.signals.includes(label)) { e.vendor_score += w; e.signals.push(label); }
      e.total_amt += (Number(row.Amount) || 0);
      e.count++;
      if (row.Vou_No) e.vouchers.add(String(row.Vou_No));
    });
  });

  const rows = [];
  vMap.forEach(e => {
    const score = Math.min(100, e.vendor_score);
    if (score < 35) return;
    rows.push({
      Account_No: e.Account_No, Party_Code: e.Party_Code,
      Beneficiary_Name: e.Beneficiary_Name, DDO_Code: e.DDO_Code, DDO_Name: e.DDO_Name,
      Vendor_Risk_Score: score, Signal_Count: e.signals.length,
      Signals_Detected: e.signals.join(" | "),
      Total_Amount: e.total_amt, Payment_Count: e.count,
      Vouchers_To_Check: [...e.vouchers].slice(0, 10).join(", "),
      Risk_Score: score,
      AUDIT_FLAG:  score >= 70 ? "IRREGULAR" : "WARNING",
      Why_Flagged: `Vendor Risk Score: ${score}/100 — ${e.signals.length} fraud signals`,
      AUDIT_ISSUE: `Vendor fraud composite (score ${score}/100): ${e.signals.join("; ")}. Total: ₹${formatIndianCurrency(e.total_amt)} across ${e.count} payments.`
    });
  });

  rows.sort((a, b) => b.Vendor_Risk_Score - a.Vendor_Risk_Score);
  const top = rows.slice(0, 50);

  return {
    data: top,
    irregularFields: ["Beneficiary_Name", "Vendor_Risk_Score", "Signal_Count"],
    findings: [
      { Metric: "Vendor-DDO Combos with Score ≥35", Value: rows.length.toString() },
      { Metric: "High Risk (Score ≥70)",             Value: rows.filter(r => r.Vendor_Risk_Score >= 70).length.toString() }
    ],
    summary: rows.length > 0
      ? `🏪 VENDOR FRAUD: ${rows.length} vendor-DDO combinations with composite risk ≥35.`
      : `✅ No vendor-DDO combinations show composite fraud indicators`
  };
}

// T-5: Auto-Generated Audit Narratives for top-20 highest-risk accounts
function run_audit_narratives(records) {
  const triage = run_triage_top_accounts(records);
  if (!triage.data || triage.data.length === 0) {
    return { data: [], irregularFields: [], findings: [],
      summary: "✅ No high-risk accounts to generate narratives for" };
  }

  const CHECK_DESC = {
    "cross_ddo_same_account":   "received Pay Bill payments from multiple DDOs simultaneously",
    "rapid_payments":           "had rapid succession payments (4+ payments in 30 days)",
    "salary_jump":              "showed an abnormal salary jump >30% with no arrear justification",
    "march_rush_new_account":   "is a new account that received large payments in year-end March",
    "annual_vendor_cap":        "exceeded the ₹10L annual payment cap from a single DDO",
    "suspicious_names":         "has a suspicious or test-like beneficiary name",
    "post_death_payments":      "continued receiving salary payments after a DCRG gratuity was paid",
    "paybill_dup_monthly":      "received duplicate Pay Bill payments in the same month",
    "split_billing":            "was involved in split billing near approval thresholds",
    "inactive_reactivation":    "was dormant for 6+ months before sudden reactivation",
    "same_day":                 "received multiple payments on the same calendar day",
    "near_approval_limits":     "had payments clustered just below sanction approval thresholds",
    "round_amounts":            "received suspiciously round-number payments",
    "ddo_march_rush":           "is associated with a DDO that exhausted 40%+ budget in last 15 days of March",
    "paybill_high_value":       "received a Pay Bill payment exceeding ₹2 Lakhs"
  };

  const narratives = triage.data.slice(0, 20).map((acct, idx) => {
    const flags = (acct.Flag_Names || "").split(" | ").map(f => f.trim()).filter(Boolean);
    const descs = flags.map(f => CHECK_DESC[f] || f).filter(Boolean);
    const descText = descs.length > 1
      ? descs.slice(0, -1).join("; ") + "; and " + descs[descs.length - 1]
      : descs[0] || "multiple audit checks triggered";
    const amt = formatIndianCurrency(acct.Total_Flagged_Amount || 0);
    const vouchers = acct.Vouchers_To_Check || "N/A";
    const narrative =
      `Account ${acct.Account_No} (${acct.Beneficiary_Name || "Unknown"}, DDO: ` +
      `${acct.DDO_Code || "N/A"} — ${acct.DDO_Name || ""}) has been flagged by ` +
      `${acct.Flags_Hit} independent audit checks with combined risk score ${acct.Total_Risk_Score}/100. ` +
      `This account ${descText}. Total amount in flagged transactions: ₹${amt}. ` +
      `Recommended action: ${acct.Recommended_Action || "MANUAL REVIEW"}. ` +
      `Vouchers for physical verification: ${vouchers}.`;

    return {
      Rank: idx + 1,
      Account_No: acct.Account_No, Beneficiary_Name: acct.Beneficiary_Name,
      DDO_Code: acct.DDO_Code, DDO_Name: acct.DDO_Name,
      Flags_Hit: acct.Flags_Hit, Risk_Score: acct.Total_Risk_Score,
      Recommended_Action: acct.Recommended_Action,
      Vouchers_To_Check: vouchers,
      Audit_Narrative: narrative,
      AUDIT_FLAG: acct.AUDIT_FLAG || "WARNING",
      Why_Flagged: `Rank #${idx+1}: ${acct.Flags_Hit} checks triggered — ${acct.Flag_Names}`,
      AUDIT_ISSUE: narrative
    };
  });

  const hp = narratives.filter(r => (r.Recommended_Action || "").includes("HIGH PRIORITY")).length;

  return {
    data: narratives,
    irregularFields: ["Account_No", "Flags_Hit", "Risk_Score"],
    findings: [
      { Metric: "Narratives Generated",     Value: narratives.length.toString() },
      { Metric: "Highest Risk Account",     Value: `${narratives[0]?.Account_No || "N/A"} (Score: ${narratives[0]?.Risk_Score || 0})` },
      { Metric: "Immediate Action Required",Value: `${hp} accounts` }
    ],
    summary: `📝 AUDIT NARRATIVES: ${narratives.length} auto-generated observations for highest-risk accounts. Copy into your audit report directly.`
  };
}

        // 8. Custom D3 Overrides Object
        window.getTreasuryAndPolFromRecords = function(records, isPayroll) {
          const k3Map = {
            "010":"BAL","020":"BAD","030":"BET","040":"BHI","050":"BPL","051":"VIN","052":"VAL","054":"CTB",
            "060":"CHA","070":"CHI","080":"DAM","090":"DAT","100":"DEW","110":"DHA","120":"DIN","130":"GUN",
            "140":"GWL","141":"MML","150":"HAR","160":"HOS","170":"IND","171":"INC","180":"JBP","181":"JBC",
            "190":"JHA","200":"KAT","210":"KHA","220":"KAR","230":"MAN","240":"MND","250":"MOR","260":"NAR",
            "270":"NEE","280":"PAN","290":"RIS","300":"RAJ","310":"RAT","320":"REW","330":"SAG","340":"SAT",
            "350":"SEH","360":"SEO","370":"SHA","380":"SAJ","390":"SHI","400":"SHE","410":"SID","420":"TIK",
            "430":"UJJ","440":"UMA","450":"VID","460":"ANU","470":"ASH","480":"BUR","490":"ALI","500":"SNG",
            "510":"AGR","520":"NIW"
          };

          function getNormTryCode(tryCode) {
            let val_str = String(tryCode).trim();
            if (!val_str) return "";
            if (val_str.endsWith(".0")) {
              val_str = val_str.slice(0, -2);
            }
            if (/^\d+$/.test(val_str)) {
              if (val_str.length === 1) return "0" + val_str + "0";
              if (val_str.length === 2) return "0" + val_str;
              if (val_str.length === 3) return val_str;
              return val_str.slice(0, 3);
            }
            return val_str.toUpperCase();
          }

          let treasury = "";
          let pol = "";
          if (records && records.length > 0) {
            for (const r of records) {
              const file = r.sourceFile || "";
              if (file) {
                const cleanFile = file.replace(/\.(xlsx|xls|csv)$/i, "").trim();
                const dateMatch = cleanFile.match(/\b(0[1-9]|1[0-2])[-_\s](\d{4})\b/);
                if (dateMatch) {
                  pol = `${dateMatch[1]}_${dateMatch[2]}`;
                }
                const parts = cleanFile.split(/[\_\-\s]+/);
                if (parts.length > 0) {
                  const firstPart = parts[0].trim().toUpperCase();
                  const ignored = ["CONSOLIDATED", "REMOVED", "DUPLICATES", "MERGED", "POL", "PAYROLL", "AUDIT", "REPORT", "IFMS", "UNKNOWN", "MULTIPART"];
                  if (firstPart && !ignored.includes(firstPart)) {
                    if (/^\d+$/.test(firstPart)) {
                      const codeNorm = getNormTryCode(firstPart);
                      if (codeNorm && k3Map[codeNorm]) {
                        treasury = k3Map[codeNorm];
                      } else if (firstPart.length === 3) {
                        treasury = firstPart;
                      }
                    } else {
                      treasury = firstPart;
                    }
                  }
                  if (!treasury && parts.length > 1) {
                    const secondPart = parts[1].trim().toUpperCase();
                    if (secondPart && !ignored.includes(secondPart) && !/^\d+$/.test(secondPart)) {
                      treasury = secondPart;
                    }
                  }
                }
              }
              if (treasury && pol) break;
            }
          }
          if (!treasury && records && records.length > 0) {
            for (const r of records) {
              if (isPayroll) {
                const tr = r.ddoName || r.ddoCode || "";
                if (tr) {
                  const trParts = tr.split(",");
                  treasury = trParts[trParts.length - 1].trim();
                  break;
                }
              } else {
                const tryCode = r.tryCode || r.tryCodeNum || r.TRY_Code || r.TRY_CD || "";
                const codeNorm = getNormTryCode(tryCode);
                if (codeNorm && k3Map[codeNorm]) {
                  treasury = k3Map[codeNorm];
                  break;
                }
                const tr = r.tryCodeChar || r.tryName || r.TRY_Name || r.voucherDetails?.tryCodeChar || "";
                if (tr) {
                  treasury = tr.trim();
                  break;
                }
                const ddo = r.ddoName || r.DDO_Name || "";
                if (ddo) {
                  const ddoParts = ddo.split(",");
                  treasury = ddoParts[ddoParts.length - 1].trim();
                  break;
                }
              }
            }
          }
          if (!treasury) treasury = "UNKNOWN_TREASURY";
          if (typeof window !== "undefined" && treasury && treasury !== "UNKNOWN_TREASURY") window.__lastTreasuryName = treasury;
          if (!pol && records && records.length > 0) {
            for (const r of records) {
              if (isPayroll) {
                const m = r.month, y = r.year;
                if (m && y) {
                  const monthsMap = {
                    january:"01", february:"02", march:"03", april:"04", may:"05", june:"06",
                    july:"07", august:"08", september:"09", october:"10", november:"11", december:"12",
                    jan:"01", feb:"02", mar:"03", apr:"04", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12"
                  };
                  const mLower = String(m).toLowerCase().trim();
                  const mNum = monthsMap[mLower] || mLower;
                  pol = `${mNum}_${y}`;
                  break;
                }
              } else {
                const m = r.paymentMonth || r.fyMonth || r.month;
                const y = r.paymentYear || r.fyYear || r.year;
                if (m && y) {
                  pol = `${String(m).padStart(2, '0')}_${y}`;
                  break;
                }
              }
            }
          }
          if (!pol) pol = "UNKNOWN_POL";
          
          treasury = treasury.replace(/[\/\\?*\[\]:\s]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
          pol = pol.replace(/[\/\\?*\[\]:\s]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
          return { treasury, pol };
        };

        function run_flag_3_corrected(records) {
          const accGroups = {};
          
          records.forEach(r => {
            const acc = ii(r.accountNo);
            if (!acc) return;
            
            if (!accGroups[acc]) {
              accGroups[acc] = {
                accountNo: acc,
                partyName: r.partyName || "",
                count: 0,
                total: 0,
                txs: []
              };
            }
            
            const g = accGroups[acc];
            g.count++;
            g.total += r.amountPaid || 0;
            g.txs.push(r);
            if (r.partyName && !g.partyName) {
              g.partyName = r.partyName;
            }
          });
          
          const flagged = [];
          Object.values(accGroups).forEach(g => {
            if (g.count > 1) {
              g.txs.sort((a, b) => {
                const dtA = bc(a.dateOfPayment);
                const dtB = bc(b.dateOfPayment);
                return (dtA && dtB) ? dtA - dtB : 0;
              });
              
              const txSlice = g.txs.slice(0, 20);
              const txDetails = txSlice.map(t => {
                const dateStr = t.dateOfPayment || "";
                const amtStr = t.amountPaid ? t.amountPaid.toLocaleString("en-IN") : "0";
                const vouStr = t.voucherNo || t.vouNo || "";
                return `[Vou: ${vouStr}, Date: ${dateStr}, Amt: ₹${amtStr}]`;
              }).join("; ") + (g.txs.length > 20 ? ` ... and ${g.txs.length - 20} more (${g.txs.length} total)` : "");
              
              const formatted = formatOutputRow(g.txs[0], "Multiple Payments Exception", `Account received ${g.count} payments`);
              formatted.Bill_Ref_No = g.txs[0].billRefNo || "";
              formatted.Account_No = g.accountNo;
              formatted.Beneficiary_Name = g.partyName;
              formatted.Payment_Count = g.count;
              formatted.Total_Amount = g.total; formatted.Amount = g.total;
              formatted.Transaction_Details = txDetails;
              formatted.AUDIT_FLAG = "IRREGULAR";
              formatted.AUDIT_ISSUE = `Account received ${g.count} payments totaling ₹${g.total.toLocaleString("en-IN")}`;
              formatted.Risk_Score = g.count > 3 ? 60 : 40;
              
              flagged.push(formatted);
            }
          });
          
          flagged.sort((a, b) => {
            if (b.Payment_Count !== a.Payment_Count) {
              return b.Payment_Count - a.Payment_Count;
            }
            return b.Total_Amount - a.Total_Amount;
          });
          
          const uniqueAccs = flagged.length;
          
          return {
            data: flagged,
            irregularFields: ["Account_No", "Payment_Count", "Total_Amount"],
            findings: [
              { Metric: "Flagged Accounts", Value: uniqueAccs.toString() },
              { Metric: "Total Multiple Payments", Value: flagged.reduce((sum, r) => sum + r.Payment_Count, 0).toString() },
              { Metric: "Total Amount Disbursed", Value: `₹${formatIndianCurrency(flagged.reduce((sum, r) => sum + r.Total_Amount, 0))}` }
            ],
            summary: ` Single Account - Multiple Payments: Flagged ${uniqueAccs} account(s) with multiple payments`
          };
        }

        function run_flag_ta_bills(records) {
          const taRecords = [];
          const groups = {};
          
          records.forEach(r => {
            const bt = (r.billType || "").trim().toUpperCase();
            const isTABill = bt === "TA BILL" || bt.includes("TA BILL") || bt === "TA" || bt === "TRAVELING ALLOWANCE" || bt === "TRAVELLING ALLOWANCE" || bt.includes("TA ALLOWANCE");
            if (!isTABill) return;
            
            const dt = bc(r.dateOfPayment);
            let year = null;
            if (dt) {
              year = dt.getFullYear();
            } else {
              const yVal = r.fyYear || r.paymentYear || "";
              const match = String(yVal).match(/\b(\d{4})\b/);
              if (match) {
                year = parseInt(match[1], 10); // v2.3 FIX: intVal was undefined
              }
            }
            if (!year) return;
            
            const accClean = ii(r.accountNo);
            if (!accClean) return;
            
            const amount = r.amountPaid || 0;
            
            taRecords.push({
              record: r,
              accountClean: accClean,
              year: year,
              amount: amount,
              dateParsed: dt
            });
            
            const _ddoForTa = String(r.ddoCode || r.DDO_Code || '').trim() || 'UNKNOWN';
            const groupKey = `${accClean}|${_ddoForTa}|${year}`; // v2.3 A-13: DDO-scoped
            if (!groups[groupKey]) {
              groups[groupKey] = {
                count: 0,
                sum: 0,
                partyNames: new Set()
              };
            }
            groups[groupKey].count++;
            groups[groupKey].sum += amount;
            if (r.partyName) groups[groupKey].partyNames.add(r.partyName);
          });
          
          const flagged = [];
          taRecords.forEach(tr => {
            const groupKey = `${tr.accountClean}|${tr.year}`;
            const g = groups[groupKey];
            
            const condSingle = tr.amount > getSetting('ta_limit_single', 19000);
            const condCumul = g.sum > getSetting('ta_limit_cumul', 50000);
            const condFreq = g.count > getSetting('ta_limit_freq', 6);
            
            if (condSingle || condCumul || condFreq) {
              const reasons = [];
              if (condSingle) {
                reasons.push(`Single TA bill amount (₹${formatIndianCurrency(tr.amount)}) exceeds ₹` + getSetting('ta_limit_single', 19000).toLocaleString('en-IN') + ``);
              }
              if (condCumul) {
                reasons.push(`Annual cumulative TA amount (₹${formatIndianCurrency(g.sum)}) exceeds ₹` + getSetting('ta_limit_cumul', 50000).toLocaleString('en-IN') + ` in year ${tr.year}`);
              }
              if (condFreq) {
                reasons.push(`Annual TA bill frequency (${g.count} times) exceeds ` + getSetting('ta_limit_freq', 6) + ` times in year ${tr.year}`);
              }
              
              const why = reasons.join("; ");
              const formatted = formatOutputRow(tr.record, "Flagged: TA Bill Exception", why);
              formatted.Why_Flagged = why;
              formatted.AUDIT_ISSUE = why;
              formatted.Risk_Score = condSingle ? 75 : 60;
              formatted._dateParsed = tr.dateParsed;
              flagged.push(formatted);
            }
          });
          
          flagged.sort((a, b) => {
            const timeA = a._dateParsed ? a._dateParsed.getTime() : 0;
            const timeB = b._dateParsed ? b._dateParsed.getTime() : 0;
            return timeB - timeA;
          });
          
          flagged.forEach(f => delete f._dateParsed);
          const uniqueAccs = new Set(flagged.map(f => f.Account_No)).size;
          
          return {
            data: flagged,
            irregularFields: ["Account_No", "Bill_Type", "Amount", "Date"],
            findings: [
              { Metric: "Total Flagged TA Bills", Value: flagged.length.toString() },
              { Metric: "Unique Accounts Involved", Value: uniqueAccs.toString() },
              { Metric: "Total Amount Involved", Value: `₹${formatIndianCurrency(flagged.reduce((sum, r) => sum + r.Amount, 0))}` }
            ],
            summary: ` Traveling Allowance (TA) Check: Flagged ${flagged.length} TA bill(s) exceeding limits across ${uniqueAccs} account(s)`
          };
        }

        // Helpers and custom implementation for exposed/new checks
        function qJ(t){
          return t<=0?{isRound:!1,pattern:""}:t%1e5===0?{isRound:!0,pattern:"LAKH"}:t%5e4===0?{isRound:!0,pattern:"HALF_LAKH"}:t%1e4===0?{isRound:!0,pattern:"TEN_THOUSAND"}:t%5e3===0?{isRound:!0,pattern:"FIVE_THOUSAND"}:t%1e3===0?{isRound:!0,pattern:"THOUSAND"}:{isRound:!1,pattern:""};
        }

        // 1. Benford's Law
        function run_flag_benfords_law(records) {
          // v2.3 C-5: Exclude PAY BILL — salary amounts follow pay-commission tables, not Benford's Law
          const benfordRecords = records.filter(r => !isPayBillRow(r));
          const validAmounts = benfordRecords.map(r => Number(r.amountPaid || 0)).filter(a => a > 0);
          if (validAmounts.length < 100) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "ℹ️ Insufficient data for Benford's Law (need 100+ records)"
            };
          }
          const expected = {1:30.1, 2:17.6, 3:12.5, 4:9.7, 5:7.9, 6:6.7, 7:5.8, 8:5.1, 9:4.6};
          const counts = {1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0};
          benfordRecords.forEach(r => { // v2.3 C-5b: iterate filtered set
            const amt = Number(r.amountPaid || 0);
            if (amt <= 0) return;
            const digits = String(amt).replace(/[^0-9]/g, "");
            if (digits.length > 0) {
              const first = parseInt(digits[0], 10);
              if (first >= 1 && first <= 9) {
                counts[first]++;
              }
            }
          });
          const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);
          if (totalCount === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "ℹ️ No positive amounts found for Benford's Law analysis"
            };
          }
          const findings = [];
          let sumDev = 0;
          const anomalousDigits = new Set();
          for (let i = 1; i <= 9; i++) {
            const actualPct = (counts[i] / totalCount) * 100;
            const expectedPct = expected[i];
            const dev = Math.abs(actualPct - expectedPct);
            sumDev += dev;
            if (actualPct > expectedPct && dev > 2.0) {
              anomalousDigits.add(i);
            }
            findings.push({
              Digit: i,
              "Expected_%": expectedPct.toFixed(1) + "%",
              "Actual_%": actualPct.toFixed(1) + "%",
              Count: counts[i],
              "Deviation_%": dev.toFixed(2) + "%",
              Status: dev > 5.0 ? "⚠️ HIGH DEVIATION" : "✅ Normal"
            });
          }
          const avgDev = sumDev / 9;
          const isAnomalous = avgDev > 3.0;
          const flaggedRows = [];
          
          if (isAnomalous) {
            records.forEach(r => {
              const amt = Number(r.amountPaid || 0);
              if (amt <= 0) return;
              const digits = String(amt).replace(/[^0-9]/g, "");
              if (digits.length > 0) {
                const first = parseInt(digits[0], 10);
                if (anomalousDigits.has(first)) {
                  const actualPct = (counts[first] / totalCount) * 100;
                  const dev = actualPct - expected[first];
                  const severity = dev > 10.0 ? "🔴 HIGH_RISK" : "🚨 IRREGULAR";
                  const why = `Amount starts with digit ${first} which has an unusually high concentration of ${actualPct.toFixed(1)}% (expected ${expected[first].toFixed(1)}%, deviation of +${dev.toFixed(2)}%)`;
                  const formatted = formatOutputRow(r, severity, why);
                  formatted.First_Digit = first;
                  formatted.Deviation_Percent = `${dev.toFixed(2)}%`;
                  formatted.Risk_Score = dev > 10.0 ? 80 : 60;
                  flaggedRows.push(formatted);
                }
              }
            });
            flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          }
          const summary = isAnomalous 
            ? `🚨 Benford's Law anomaly (avg deviation: ${avgDev.toFixed(2)}%) | Flagged ${flaggedRows.length} records on anomalous digits: ${Array.from(anomalousDigits).join(", ")}`
            : `✅ Data conforms to Benford's Law (avg deviation: ${avgDev.toFixed(2)}%)`;
          return {
            data: flaggedRows.slice(0, 1000),
            irregularFields: ["Amount", "First_Digit", "Deviation_Percent"],
            findings: findings,
            summary: summary
          };
        }

        // 2. Round Amounts
        function run_flag_round_amounts(records) {
          const flaggedRows = [];
          const counts = { LAKH: 0, HALF_LAKH: 0, TEN_THOUSAND: 0, FIVE_THOUSAND: 0, THOUSAND: 0 };
          const totalValid = records.filter(r => Number(r.amountPaid || 0) > 0).length;
          
          records.forEach(r => {
            if (isPayBillRow(r)) return; // v2.3 C-6: PAY BILL salaries are inherently round numbers
            const amt = Number(r.amountPaid || 0);
            if (amt <= 0) return;
            
            let isRound = false;
            let pattern = "";
            let score = 0;
            // v2.3.1 C-10: raised scores; added "exactly at procurement threshold" tier
            const _procThresholds = [20000, 50000, 250000, 500000, 2500000];
            if (_procThresholds.includes(amt)) { isRound = true; pattern = "AT_THRESHOLD"; score = 65; }
            else if (amt % 100000 === 0) { isRound = true; pattern = "LAKH"; score = 50; }
            else if (amt % 50000 === 0) { isRound = true; pattern = "HALF_LAKH"; score = 40; }
            else if (amt % 10000 === 0) { isRound = true; pattern = "TEN_THOUSAND"; score = 30; }
            else if (amt % 5000 === 0) { isRound = true; pattern = "FIVE_THOUSAND"; score = 20; }
            else if (amt % 1000 === 0) { isRound = true; pattern = "THOUSAND"; score = 10; }
            
            if (isRound) {
              counts[pattern] = (counts[pattern] || 0) + 1;
              const _roundLabel = pattern === "AT_THRESHOLD"
                ? `Amount is exactly at a procurement limit threshold (₹${formatIndianCurrency(amt)})` 
                : `Round amount detected: ${pattern}`;
              const formatted = formatOutputRow(r, score >= 65 ? "⚠️ WARNING" : "ℹ️ INFO", _roundLabel);
              formatted.Round_Pattern = pattern;
              formatted.Risk_Score = score;
              formatted.Why_Flagged = _roundLabel;
              flaggedRows.push(formatted);
            }
          });
          
          const roundPct = totalValid > 0 ? (flaggedRows.length / totalValid) * 100 : 0;
          const isHighConcentration = roundPct > getSetting('round_concentration_pct', 20.0);
          
          flaggedRows.forEach(r => {
            r.AUDIT_FLAG = isHighConcentration ? "⚠️ WARNING" : "ℹ️ INFO";
          });
          
          const findings = Object.entries(counts).map(([pat, cnt]) => ({
            Pattern: pat,
            Count: cnt,
            Percentage: totalValid > 0 ? `${((cnt / totalValid) * 100).toFixed(2)}%` : "0%"
          }));
          
          const summary = isHighConcentration 
            ? `⚠️ WARNING: ${flaggedRows.length} round amounts (${roundPct.toFixed(1)}%) - unusually high concentration`
            : `ℹ️ INFO: ${flaggedRows.length} round amounts found (${roundPct.toFixed(1)}%)`;
            
          return {
            data: flaggedRows.slice(0, 500),
            irregularFields: isHighConcentration ? ["Amount", "Round_Pattern"] : [],
            findings: findings,
            summary: summary
          };
        }

        // 3. Same Day
        function run_flag_same_day(records) {
          const groups = {};
          records.forEach(r => {
            const acc = ii(r.accountNo);
            const dt = bc(r.dateOfPayment);
            if (!acc || !dt) return;
            // v2.3 C-9: skip micro-transactions to reduce false positives
            if (Number(r.amountPaid || 0) < getSetting('same_day_min_amount', 5000)) return;
            const dateStr = dt.toISOString().split('T')[0];
            const key = `${acc}|${dateStr}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(r);
          });
          
          const flaggedRows = [];
          const findings = [];
          let anomalyCount = 0;
          
          Object.entries(groups).forEach(([key, rows]) => {
            if (rows.length > getSetting('same_day_freq_limit', 1)) {
              anomalyCount++;
              const [acc, dateStr] = key.split('|');
              const totalAmt = rows.reduce((sum, r) => sum + (r.amountPaid || 0), 0);
              const severity = rows.length > getSetting('same_day_warning_limit', 3) ? "WARNING" : "REVIEW";
              const risk = rows.length > 3 ? 40 : 20;
              
              rows.forEach(r => {
                const formatted = formatOutputRow(r, `Same-Day Multiple Payments: ${severity}`, `Account received ${rows.length} separate payments on the same day (${formatDate(dateStr)}) totaling ₹${formatIndianCurrency(totalAmt)}`);
                formatted.Same_Day_Count = rows.length;
                formatted.Same_Day_Total = totalAmt;
                formatted.Risk_Score = risk;
                formatted.Why_Flagged = `Account received ${rows.length} separate payments on the same day (${formatDate(dateStr)}) totaling ₹${formatIndianCurrency(totalAmt)}`;
                formatted.AUDIT_ISSUE = formatted.Why_Flagged;
                flaggedRows.push(formatted);
              });
              
              findings.push({
                Account_No: acc,
                Date: formatDate(dateStr),
                Payment_Count: rows.length,
                Total_Amount: `₹${formatIndianCurrency(totalAmt)}`,
                Severity: severity
              });
            }
          });
          
          flaggedRows.sort((a, b) => b.Same_Day_Count - a.Same_Day_Count);
          findings.sort((a, b) => b.Payment_Count - a.Payment_Count);
          
          const summary = flaggedRows.length > 0 
            ? `⚠️ WARNING: ${anomalyCount} accounts with multiple same-day payments (${flaggedRows.length} records)`
            : `✅ No same-day multiple payments found`;
            
          return {
            data: flaggedRows.slice(0, 500),
            irregularFields: ["Account_No", "Date", "Amount"],
            findings: findings.slice(0, 50),
            summary: summary
          };
        }

        // 4. Rapid Payments
        function run_flag_rapid_payments(records) {
          const accGroups = {};
          records.forEach(r => {
            const acc = ii(r.accountNo);
            if (!acc) return;
            if (!accGroups[acc]) accGroups[acc] = [];
            accGroups[acc].push(r);
          });
          
          const rapidAccs = [];
          const flaggedRows = [];
          
          Object.entries(accGroups).forEach(([acc, rows]) => {
            if (rows.length < 3) return;
            const sortedRows = rows.map(r => ({ ...r, parsedDate: bc(r.dateOfPayment) }))
                                   .filter(r => r.parsedDate !== null)
                                   .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
            if (sortedRows.length < getSetting('rapid_min_count', 3)) return;
            
            // v2.3.1 A-9: Sliding 30-day window replaces average-gap (which hides burst fraud)
            // Average gap approach misses: 24 normal monthly + 5 same-week payments
            const windowDays   = getSetting("rapid_window_days", 30);
            const windowCount  = getSetting("rapid_window_count", 4);
            const sortedDates  = sortedRows.map(r => r.parsedDate.getTime());
            const totalAmt     = sortedRows.reduce((s, r) => s + (r.amountPaid || 0), 0);
            let maxWindow = 0;
            let burstStart = -1;
            for (let i = 0; i < sortedDates.length; i++) {
              let cnt = 1;
              for (let j = i + 1; j < sortedDates.length; j++) {
                if ((sortedDates[j] - sortedDates[i]) / 86400000 <= windowDays) cnt++;
                else break;
              }
              if (cnt > maxWindow) { maxWindow = cnt; burstStart = i; }
            }
            if (maxWindow >= windowCount) {
              const burstEnd   = burstStart + maxWindow - 1;
              const burstDays  = ((sortedDates[Math.min(burstEnd, sortedDates.length-1)] - sortedDates[burstStart]) / 86400000).toFixed(1);
              const severity   = maxWindow >= windowCount * 2 ? "IRREGULAR" : "WARNING";
              const score      = maxWindow >= windowCount * 2 ? 70 : 50;
              const reason     = `Rapid succession: ${maxWindow} payments in ${burstDays} days (window: ${windowDays}d, threshold: ${windowCount}+)`;
              sortedRows.forEach(r => {
                const formatted = formatOutputRow(r, "Flagged: Rapid Succession (Burst)", reason);
                formatted.Burst_Count    = maxWindow;
                formatted.Burst_Days     = burstDays;
                formatted.Risk_Score     = score;
                formatted.Why_Flagged    = reason;
                formatted.AUDIT_ISSUE    = reason;
                flaggedRows.push(formatted);
              });
              rapidAccs.push({
                Account_No:       acc,
                Beneficiary_Name: sortedRows[0].partyName || "Unknown",
                Payment_Count:    sortedRows.length,
                Max_Burst_Count:  maxWindow,
                Burst_Span_Days:  burstDays,
                Total_Amount:     `₹${formatIndianCurrency(totalAmt)}`,
                Severity:         severity
              });
            }
          });
          
          flaggedRows.sort((a, b) => a.Avg_Days_Between - b.Avg_Days_Between);
          rapidAccs.sort((a, b) => a.Avg_Days - b.Avg_Days);
          
          const summary = rapidAccs.length > 0 
            ? `🚨 IRREGULAR: ${rapidAccs.length} accounts with rapid succession payments (avg <= ` + getSetting('rapid_avg_days', 5.0) + ` days apart)`
            : `✅ No rapid succession payments detected`;
            
          return {
            data: flaggedRows.slice(0, 500),
            irregularFields: ["Account_No", "Party_Code", "Avg_Days_Between"],
            findings: rapidAccs.slice(0, 30),
            summary: summary
          };
        }

        // 5. Cross DDO
        function run_flag_cross_ddo(records) {
          const partyToDdos = {};
          const partyToRows = {};
          records.forEach(r => {
            const pcode = io(r.partyCode);
            if (!pcode || pcode === "0" || pcode === "104" || pcode === "NAN" || pcode === "NONE") return;
            const ddo = String(r.ddoCode || '').trim();
            if (!ddo) return;
            
            if (!partyToDdos[pcode]) {
              partyToDdos[pcode] = new Set();
              partyToRows[pcode] = [];
            }
            partyToDdos[pcode].add(ddo);
            partyToRows[pcode].push(r);
          });
          
          const flaggedRows = [];
          const findings = [];
          let flaggedPartiesCount = 0;
          
          Object.entries(partyToDdos).forEach(([pcode, ddosSet]) => {
            if (ddosSet.size > 1) {
              flaggedPartiesCount++;
              const ddosList = Array.from(ddosSet);
              const rows = partyToRows[pcode];
              const totalAmt = rows.reduce((sum, r) => sum + (r.amountPaid || 0), 0);
              const severity = ddosList.length > 3 ? "WARNING" : "REVIEW";
              const score = ddosList.length > 3 ? 40 : 25;
              const reason = `Party code received payments from ${ddosList.length} different DDOs: ${ddosList.join(', ')}`;
              
              rows.forEach(r => {
                const formatted = formatOutputRow(r, `Cross-DDO: ${severity}`, reason);
                formatted.DDO_Count = ddosList.length;
                formatted.Risk_Score = score;
                formatted.Why_Flagged = reason;
                formatted.AUDIT_ISSUE = reason;
                flaggedRows.push(formatted);
              });
              
              findings.push({
                Party_Code: pcode,
                Beneficiary_Name: rows[0].partyName || "Unknown",
                DDO_Count: ddosList.length,
                DDOs: ddosList.join(", "),
                Total_Amount: `₹${formatIndianCurrency(totalAmt)}`,
                Severity: severity
              });
            }
          });
          
          flaggedRows.sort((a, b) => b.DDO_Count - a.DDO_Count);
          findings.sort((a, b) => b.DDO_Count - a.DDO_Count);
          
          const summary = flaggedPartiesCount > 0 
            ? `⚠️ WARNING: ${flaggedPartiesCount} parties receiving payments from multiple DDOs`
            : `ℹ️ No cross-DDO payments found`;
            
          return {
            data: flaggedRows.slice(0, 500),
            irregularFields: ["Party_Code", "DDO_Code"],
            findings: findings.slice(0, 30),
            summary: summary
          };
        }

        // 6. Inactive Reactivation
        function run_flag_inactive_reactivation(records) {
          const accGroups = {};
          records.forEach(r => {
            const acc = ii(r.accountNo);
            if (!acc) return;
            if (!accGroups[acc]) accGroups[acc] = [];
            accGroups[acc].push(r);
          });
          
          const reactivations = [];
          const flaggedRows = [];
          
          Object.entries(accGroups).forEach(([acc, rows]) => {
            if (rows.length < 2) return;
            const sortedRows = rows.map(r => ({ ...r, parsedDate: bc(r.dateOfPayment) }))
                                   .filter(r => r.parsedDate !== null)
                                   .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
            if (sortedRows.length < 2) return;
            
            for (let i = 1; i < sortedRows.length; i++) {
              const diffMs = sortedRows[i].parsedDate.getTime() - sortedRows[i-1].parsedDate.getTime();
              const gapDays = diffMs / (1000 * 60 * 60 * 24);
              const reactivationAmt = Number(sortedRows[i].amountPaid || 0);
              
              if (gapDays > getSetting('dormant_gap_days', 270) && reactivationAmt >= getSetting('dormant_reactivation_amt', 50000)) {
                const severity = gapDays > getSetting('dormant_high_risk_days', 365) ? "WARNING" : "REVIEW";
                const score = gapDays > getSetting('dormant_high_risk_days', 365) ? 40 : 20;
                const gapMonths = Math.round(gapDays / 30);
                const reason = `High-value payment (₹${formatIndianCurrency(reactivationAmt)}) made on account after dormancy of ${gapMonths} months (last active: ${formatDate(sortedRows[i-1].parsedDate)})`;
                
                sortedRows.forEach(r => {
                  const formatted = formatOutputRow(r, `Flagged: Reactivation`, reason);
                  formatted.Dormancy_Days = Math.round(gapDays);
                  formatted.Risk_Score = score;
                  formatted.Why_Flagged = reason;
                  formatted.AUDIT_ISSUE = reason;
                  flaggedRows.push(formatted);
                });
                
                reactivations.push({
                  Account_No: acc,
                  Gap_Days: Math.round(gapDays),
                  Gap_Months: gapMonths,
                  Last_Active: formatDate(sortedRows[i-1].parsedDate),
                  Reactivated: formatDate(sortedRows[i].parsedDate),
                  Reactivation_Amount: `₹${formatIndianCurrency(reactivationAmt)}`,
                  Severity: severity
                });
                break;
              }
            }
          });
          
          flaggedRows.sort((a, b) => b.Dormancy_Days - a.Dormancy_Days);
          reactivations.sort((a, b) => b.Gap_Days - a.Gap_Days);
          
          const summary = reactivations.length > 0 
            ? `⚠️ WARNING: ${reactivations.length} accounts reactivated with high-value payments (>= ₹` + getSetting('dormant_reactivation_amt', 50000).toLocaleString('en-IN') + `) after ` + Math.round(getSetting('dormant_gap_days', 270) / 30) + `+ months dormancy`
            : `✅ No dormant account reactivations detected`;
            
          return {
            data: flaggedRows.slice(0, 500),
            irregularFields: ["Account_No", "Date"],
            findings: reactivations.slice(0, 30),
            summary: summary
          };
        }

        // 7. Duplicate UTR
        function run_flag_duplicate_utr(records) {
          const utrGroups = {};
          records.forEach(r => {
            const utr = String(r.utrNo || '').trim().toUpperCase();
            if (!utr || utr === "NAN" || utr === "NONE" || utr === "0") return;
            if (!utrGroups[utr]) utrGroups[utr] = [];
            utrGroups[utr].push(r);
          });
          
          const flaggedRows = [];
          const findings = [];
          let anomalyCount = 0;
          
          Object.entries(utrGroups).forEach(([utr, rows]) => {
            if (rows.length < 2) return;
            
            const uniqueAmounts = new Set(rows.map(r => Number(r.amountPaid || 0)));
            const uniqueParties = new Set(rows.map(r => io(r.partyCode)));
            
            if (uniqueAmounts.size > 1 || uniqueParties.size > 1) {
              anomalyCount++;
              const totalAmt = rows.reduce((sum, r) => sum + (r.amountPaid || 0), 0);
              const reason = `Same UTR number (${utr}) used for multiple different payments or parties`;
              
              rows.forEach(r => {
                const formatted = formatOutputRow(r, "🔴 HIGH_RISK", reason);
                formatted.UTR_Duplicate = "Yes";
                formatted.Risk_Score = 80;
                formatted.Why_Flagged = reason;
                formatted.AUDIT_ISSUE = reason;
                flaggedRows.push(formatted);
              });
              
              findings.push({
                UTR_No: utr,
                Records: rows.length,
                Total_Amount: `₹${formatIndianCurrency(totalAmt)}`,
                Severity: "HIGH_RISK"
              });
            }
          });
          
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          findings.sort((a, b) => b.Records - a.Records);
          
          const summary = flaggedRows.length > 0 
            ? `🔴 HIGH RISK: ${anomalyCount} UTR numbers used for multiple different payments`
            : `✅ No duplicate UTR numbers found`;
            
          return {
            data: flaggedRows,
            irregularFields: ["UTR_No", "Party_Code", "Amount"],
            findings: findings.slice(0, 30),
            summary: summary
          };
        }

        // 8. Same Amt Diff Voucher
        function run_flag_same_amt_diff_voucher(records) {
          const groups = {};
          records.forEach(r => {
            const pcode = io(r.partyCode);
            const amt = Number(r.amountPaid || 0);
            if (!pcode || amt <= 0) return;
            const key = `${pcode}|${amt}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(r);
          });
          
          const flaggedRows = [];
          const findings = [];
          let anomalyCount = 0;
          
          Object.entries(groups).forEach(([key, rows]) => {
            if (rows.length < 2) return;
            
            const uniqueVouchers = new Set(rows.map(r => String(r.voucherNo || '').trim()));
            if (uniqueVouchers.size < 2) return;
            
            const parsedRows = rows.map(r => ({ ...r, parsedDate: bc(r.dateOfPayment) }))
                                   .filter(r => r.parsedDate !== null)
                                   .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
            if (parsedRows.length < 2) return;
            
            const gapMs = parsedRows[parsedRows.length - 1].parsedDate.getTime() - parsedRows[0].parsedDate.getTime();
            const gapDays = gapMs / (1000 * 60 * 60 * 24);
            
            if (gapDays <= getSetting('same_amt_gap_days', 30.0)) {
              anomalyCount++;
              const [pcode, amt] = key.split('|');
              const reason = `Same party and same amount (₹${formatIndianCurrency(amt)}) paid via multiple different vouchers within ` + getSetting('same_amt_gap_days', 30) + ` days`;
              
              parsedRows.forEach(r => {
                const formatted = formatOutputRow(r, "🚨 IRREGULAR", reason);
                formatted.Risk_Score = 60;
                formatted.Why_Flagged = reason;
                formatted.AUDIT_ISSUE = reason;
                flaggedRows.push(formatted);
              });
              
              findings.push({
                Party_Code: pcode,
                Amount: Number(amt),
                Records: parsedRows.length,
                Severity: "IRREGULAR"
              });
            }
          });
          
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          findings.sort((a, b) => b.Amount - a.Amount);
          
          const summary = flaggedRows.length > 0 
            ? `🚨 IRREGULAR: ${anomalyCount} cases of same amount paid via different vouchers within ` + getSetting('same_amt_gap_days', 30) + ` days`
            : `✅ No suspicious same-amount different-voucher patterns found`;
            
          return {
            data: flaggedRows,
            irregularFields: ["Party_Code", "Amount", "Vou_No"],
            findings: findings.slice(0, 30),
            summary: summary
          };
        }

        // 9. Split Billing (New!)
        function run_flag_split_billing(records) {
          const ddoPartyGroup = {};
          records.forEach(r => {
            const ddo = String(r.ddoCode || '').trim();
            const pcode = io(r.partyCode);
            const dt = bc(r.dateOfPayment);
            const mh = String(r.majorHead || '').trim();
            if (!ddo || !pcode || !dt || !mh) return;
            
            const key = `${ddo}|${pcode}|${mh}`;
            if (!ddoPartyGroup[key]) ddoPartyGroup[key] = [];
            ddoPartyGroup[key].push({ record: r, date: dt });
          });
          
          const flaggedRows = [];
          const findings = [];
          const uniqueFlaggedVouchers = new Set();
          let splitGroupsCount = 0;
          const thresholds = getSetting('split_billing_thresholds', [20000, 50000, 250000, 500000, 1000000]);
          
          Object.entries(ddoPartyGroup).forEach(([key, items]) => {
            if (items.length < 2) return;
            
            // Sort items chronologically
            items.sort((a, b) => a.date.getTime() - b.date.getTime());
            
            const [ddo, pcode, mh] = key.split('|');
            
            // Sliding window algorithm (3-day window)
            const n = items.length;
            
            for (let i = 0; i < n; i++) {
              const startItem = items[i];
              const windowItems = [startItem];
              let windowSum = Number(startItem.record.amountPaid || 0);
              
              for (let j = i + 1; j < n; j++) {
                const nextItem = items[j];
                const diffTime = nextItem.date.getTime() - startItem.date.getTime();
                const diffDays = diffTime / (1000 * 60 * 60 * 24);
                
                if (diffDays <= getSetting('split_billing_window_days', 3)) { // v2.3
                  windowItems.push(nextItem);
                  windowSum += Number(nextItem.record.amountPaid || 0);
                } else {
                  break;
                }
              }
              
              if (windowItems.length >= 2) {
                // Check if the windowSum crosses any threshold while all individual items are below it
                let isSplit = false;
                let matchingLimit = 0;
                
                for (let limit of thresholds) {
                  if (windowSum >= limit) {
                    const allBelow = windowItems.every(item => Number(item.record.amountPaid || 0) < limit);
                    if (allBelow) {
                      isSplit = true;
                      matchingLimit = limit;
                    }
                  }
                }
                
                if (isSplit) {
                  // Construct a summary representation
                  const dateListStr = windowItems.map(item => formatDate(item.record.dateOfPayment)).join(", ");
                  const totalAmtStr = `₹${formatIndianCurrency(windowSum)}`;
                  const limitStr = `₹${formatIndianCurrency(matchingLimit)}`;
                  const reason = `Potential split billing: ${windowItems.length} vouchers under ${limitStr} threshold to same party in a 3-day window totaling ${totalAmtStr} (major head ${mh}, dates: [${dateListStr}])`;
                  
                  windowItems.forEach(item => {
                    const r = item.record;
                    const vouKey = `${r.ddoCode}|${r.partyCode}|${r.voucherNo || r.vouNo || ''}|${r.amountPaid}`;
                    if (!uniqueFlaggedVouchers.has(vouKey)) {
                      uniqueFlaggedVouchers.add(vouKey);
                      const formatted = formatOutputRow(r, "🚨 IRREGULAR", reason);
                      formatted.Risk_Score = 75; // Raised slightly because sliding window captures more deliberate patterns
                      formatted.Why_Flagged = reason;
                      formatted.AUDIT_ISSUE = reason;
                      formatted.Duplicate_Group = key;
                      flaggedRows.push(formatted);
                    }
                  });
                  
                  splitGroupsCount++;
                  findings.push({
                    DDO_Code: ddo,
                    Party_Code: pcode,
                    Date: `${formatDate(startItem.record.dateOfPayment)} to ${formatDate(windowItems[windowItems.length - 1].record.dateOfPayment)}`,
                    Major_Head: mh,
                    Vouchers: windowItems.length,
                    Total_Amount: totalAmtStr,
                    Threshold_Circumvented: limitStr,
                    Severity: "IRREGULAR"
                  });
                  
                  // Move i forward to the end of this window to avoid overlapping group duplicates
                  i = items.indexOf(windowItems[windowItems.length - 1]);
                }
              }
            }
          });
          
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          findings.sort((a, b) => b.Vouchers - a.Vouchers);
          
          const summary = flaggedRows.length > 0 
            ? `🚨 IRREGULAR: Found ${splitGroupsCount} cases of split billing within a sliding 3-day window under procurement limits`
            : `✅ No split billing patterns detected`;
            
          return {
            data: flaggedRows,
            irregularFields: ["DDO_Code", "Party_Code", "Amount", "Date"],
            findings: findings.slice(0, 30),
            summary: summary
          };
        }

        // 10. Cash Payments (New!)
        function run_flag_cash_payments(records) {
          const flaggedRows = [];
          const findings = [];
          
          records.forEach(r => {
            const mode = String(r.paymentMode || '').trim().toUpperCase();
            const amt = Number(r.amountPaid || 0);
            if (amt <= 0) return;
            
            const isCash = mode === "CASH" || mode.includes("CASH");
            if (isCash && amt > getSetting('cash_payment_cap', 5000)) {
              const reason = `High-value CASH payment of ₹${formatIndianCurrency(amt)} (Exceeds government cash payment cap of ₹` + getSetting('cash_payment_cap', 5000).toLocaleString('en-IN') + `)`;
              const formatted = formatOutputRow(r, "⚠️ WARNING", reason);
              formatted.Risk_Score = 55;
              formatted.Why_Flagged = reason;
              formatted.AUDIT_ISSUE = reason;
              flaggedRows.push(formatted);
              
              findings.push({
                Voucher: r.voucherNo || "Unknown",
                Party_Code: r.partyCode || "Unknown",
                Amount: amt,
                Payment_Mode: r.paymentMode || "CASH",
                Severity: "WARNING"
              });
            }
          });
          
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          
          const summary = flaggedRows.length > 0 
            ? `⚠️ WARNING: Found ${flaggedRows.length} high-value cash transactions exceeding limits`
            : `✅ No high-value cash transactions detected`;
            
          return {
            data: flaggedRows,
            irregularFields: ["Amount", "Payment_Mode"],
            findings: findings.slice(0, 50),
            summary: summary
          };
        }

        // 11. Vendor Concentration (New worker implementation!)
        function run_flag_vendor_concentration(records) {
          // v2.3.1 C-7: Exclude micro-transactions to prevent distorted concentration
          const _vcMinAmt = getSetting("vendor_min_txn_amount", 1000);
          const e = {};
          records.forEach(o=>{
            if(!o.partyCode)return;
            if((o.amountPaid || 0) < _vcMinAmt) return; // skip micro-transactions
            const l=io(o.partyCode);
            e[l]||(e[l]={amount:0,count:0,name:o.partyName}),e[l].amount+=o.amountPaid,e[l].count++
          });
          const r=records.filter(o=>o.partyCode && (o.amountPaid||0)>=_vcMinAmt).reduce((o,l)=>o+l.amountPaid,0);
          const a=Object.entries(e).map(([o,l])=>({partyCode:o,...l,percentage:r>0?l.amount/r*100:0})).sort((o,l)=>l.amount-o.amount);
          let n=0;
          a.slice(0,10).forEach(o=>n+=o.amount);
          const i=r>0?n/r*100:0;
          const s=i>getSetting('vendor_concentration_pct', 50);
          return {
            data:a.slice(0,100).map((o,l)=>({Rank:l+1,Party_Code:o.partyCode,Beneficiary_Name:o.name,Payment_Count:o.count,Total_Amount:o.amount,Percentage:`${o.percentage.toFixed(2)}%`,AUDIT_FLAG:s&&l<10?"⚠️ HIGH CONCENTRATION":""})),
            irregularFields:s?["Total_Amount","Percentage"]:[],
            findings:[{Metric:"Total Parties",Value:Object.keys(e).length.toString()},{Metric:"Top 10 Amount %",Value:`${i.toFixed(2)}%`},{Metric:"Concentration",Value:s?"HIGH":i>30?"MEDIUM":"LOW"}],
            summary:s?`🚨 HIGH CONCENTRATION: Top 10 parties receive ${i.toFixed(1)}% of total payments`:`ℹ️ INFO: Top 10 parties receive ${i.toFixed(1)}% of total payments`
          };
        }

        // 12. Payroll rules
        window.run_gross_net_discrepancy = function(records) {
          const flaggedRows = [];
          const findings = [];
          
          records.forEach(r => {
            const basic = Number(r.basicPay || 0);
            if (basic <= 0) return;
            
            const gross = Number(r.grossSalary || 0);
            const ded = Number(r.totalDeductions || 0);
            const net = Number(r.netSalary || 0);
            
            const diff = Math.abs(gross - ded - net);
            if (diff > 1.0) {
              const reason = `Gross Salary (₹${window.Lu(gross)}) minus Deductions (₹${window.Lu(ded)}) does not equal Net Salary (₹${window.Lu(net)}). Discrepancy: ₹${window.Lu(diff)}`;
              const formatted = window.Oi(r, true, "🔴 NET DISCREPANCY", reason);
              formatted.Risk_Score = 80;
              formatted.Why_Flagged = reason;
              formatted.AUDIT_ISSUE = reason;
              flaggedRows.push(formatted);
              
              findings.push({
                Employee_Code: r.employeeCode || "Unknown",
                Employee_Name: r.employeeName || "Unknown",
                Gross_Salary: gross,
                Total_Deductions: ded,
                Net_Salary: net,
                Discrepancy: diff,
                Severity: "HIGH_RISK"
              });
            }
          });
          
          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const dA = window.parseDDMMYYYY(a.Date);
            const dB = window.parseDDMMYYYY(b.Date);
            if (dA && dB) return dA.getTime() - dB.getTime();
            return 0;
          });
          
          const summary = flaggedRows.length > 0
            ? `🔴 HIGH RISK: Found ${flaggedRows.length} employee records with Gross-to-Net Pay discrepancies!`
            : `✅ No Gross-to-Net Pay discrepancies found`;
            
          return {
            data: flaggedRows,
            irregularFields: ["Gross_Salary", "Total_Deductions", "Net_Salary"],
            findings: findings.slice(0, 50),
            summary: summary
          };
        };

        window.run_excessive_allowances = function(records) {
          const flaggedRows = [];
          const findings = [];
          
          records.forEach(r => {
            const basic = Number(r.basicPay || 0);
            if (basic <= 0) return;
            
            let otherAllowancesSum = 0;
            if (r.allowances) {
              Object.entries(r.allowances).forEach(([key, val]) => {
                const kLower = key.toLowerCase();
                if (kLower !== "da" && kLower !== "hra" && !kLower.includes("dearness") && !kLower.includes("house_rent") && !kLower.includes("houserent")) {
                  otherAllowancesSum += Number(val || 0);
                }
              });
            }
            
            const ratio = otherAllowancesSum / basic;
            if (ratio > 0.5) {
              const reason = `Other allowances (₹${window.Lu(otherAllowancesSum)}) exceed 50% of Basic Pay (₹${window.Lu(basic)}). Ratio: ${(ratio * 100).toFixed(1)}%`;
              const formatted = window.Oi(r, true, "⚠️ EXCESSIVE ALLOWANCE", reason);
              formatted.Risk_Score = 50;
              formatted.Why_Flagged = reason;
              formatted.AUDIT_ISSUE = reason;
              flaggedRows.push(formatted);
              
              findings.push({
                Employee_Code: r.employeeCode || "Unknown",
                Employee_Name: r.employeeName || "Unknown",
                Basic_Pay: basic,
                Other_Allowances: otherAllowancesSum,
                Percentage: `${(ratio * 100).toFixed(1)}%`,
                Severity: "WARNING"
              });
            }
          });
          
          flaggedRows.sort((a, b) => b.Basic_Pay - a.Basic_Pay);
          
          const summary = flaggedRows.length > 0
            ? `⚠️ WARNING: Found ${flaggedRows.length} employee records with other allowances exceeding 50% of Basic Pay`
            : `✅ No excessive allowance outliers found`;
            
          return {
            data: flaggedRows,
            irregularFields: ["Basic_Pay"],
            findings: findings.slice(0, 50),
            summary: summary
          };
        };

        window.run_duplicate_gpf_pran = function(records) {
          const gpfGroups = {};
          records.forEach(r => {
            const val = String(r.gpfDpfPranAc || '').trim().toUpperCase();
            if (!val || val === "NAN" || val === "NONE" || val === "0" || val === "N/A" || val === "NA") return;
            if (!gpfGroups[val]) gpfGroups[val] = [];
            gpfGroups[val].push(r);
          });
          
          const flaggedRows = [];
          const findings = [];
          let duplicateCount = 0;
          
          Object.entries(gpfGroups).forEach(([gpf, rows]) => {
            const uniqueEmpCodes = new Set(rows.map(r => String(r.employeeCode || '').trim()));
            if (uniqueEmpCodes.size > 1) {
              duplicateCount++;
              const reason = `Same GPF/PRAN number (${gpf}) is mapped to multiple distinct employee codes: ${Array.from(uniqueEmpCodes).join(', ')}`;
              
              rows.forEach(r => {
                const formatted = window.Oi(r, true, "🚨 DUPLICATE GPF/PRAN", reason);
                formatted.Risk_Score = 70;
                formatted.Why_Flagged = reason;
                formatted.AUDIT_ISSUE = reason;
                flaggedRows.push(formatted);
              });
              
              findings.push({
                Account_No: gpf,
                Duplicate_Codes: Array.from(uniqueEmpCodes).join(", "),
                Employee_Count: uniqueEmpCodes.size,
                Severity: "IRREGULAR"
              });
            }
          });
          
          flaggedRows.sort((a, b) => a.Employee_Code.localeCompare(b.Employee_Code));
          
          const summary = flaggedRows.length > 0
            ? `🚨 IRREGULAR: Found ${duplicateCount} duplicate GPF/PRAN accounts mapped to multiple employees`
            : `✅ No duplicate GPF/PRAN accounts found`;
            
          return {
            data: flaggedRows,
            irregularFields: ["GPF_PRAN_Ac", "Employee_Code"],
            findings: findings.slice(0, 50),
            summary: summary
          };
        };



        function run_flag_approval_limits(records) {
          // v2.3.1 C-8: thresholds and proximity band are now configurable
          const _defaultLimits = [5000, 10000, 25000, 50000, 100000, 500000, 1000000];
          const _limits = getSetting("approval_thresholds", _defaultLimits);
          const _bandPct = getSetting("approval_band_pct", 5.0) / 100;
          const thresholds = _limits.map(v => ({ limit: v, label: `₹${formatIndianCurrency(v)}` }));
          const flaggedRows = [];
          
          records.forEach(r => {
            const amt = r.amountPaid;
            if (!amt || amt <= 0) return;
            
            for (const item of thresholds) {
              const limit = item.limit;
              const lowerBound = limit * (1 - _bandPct);
              if (amt >= lowerBound && amt < limit) {
                flaggedRows.push({
                  ...r,
                  limitLabel: item.label,
                  limitVal: limit,
                  gap: limit - amt
                });
                break;
              }
            }
          });
          
          if (flaggedRows.length === 0) {
            return {
              data: [],
              irregularFields: [],
              findings: [],
              summary: "✅ No payments near approval limits found"
            };
          }
          
          flaggedRows.sort((a, b) => a.gap - b.gap);
          const sliced = flaggedRows.slice(0, 500);
          
          const formattedData = sliced.map(r => {
            const pct = (r.gap / r.limitVal) * 100;
            const severity = pct < 2.0 ? "IRREGULAR" : "WARNING";
            const severityLabel = severity === "IRREGULAR" ? "🚨 IRREGULAR" : "⚠️ WARNING";
            
            const formatted = formatOutputRow(r, `${severityLabel} ${severity}`, `Amount within ${pct.toFixed(2)}% of ${r.limitLabel} approval limit`);
            formatted.Approval_Limit = r.limitLabel;
            formatted.Gap_Amount = r.gap;
            formatted["Gap_%"] = `${pct.toFixed(2)}%`;
            formatted.Gap_Percent = `${pct.toFixed(2)}%`;
            formatted.Risk_Score = pct < 2.0 ? 60 : 40;
            
            return formatted;
          });
          
          return {
            data: formattedData,
            irregularFields: ["Amount", "Approval_Limit", "Gap_Amount"],
            findings: [],
            summary: `⚠️ WARNING: ${flaggedRows.length} payments within 5% of approval limits`
          };
        }

        function run_flag_same_name_multi_ddo_paybill(records) {
          const COL_NAME = "partyName";
          const COL_DDO = "ddoCode";
          const COL_DDO_NAME = "ddoName";
          const COL_AMT = "amountPaid";

          const nameGroups = {};
          records.forEach(r => {
            if (!isPayBillRow(r)) return;
            const nameNorm = Rc(r[COL_NAME]);
            if (!nameNorm || nameNorm.length < 3) return;

            if (!nameGroups[nameNorm]) {
              nameGroups[nameNorm] = [];
            }
            nameGroups[nameNorm].push(r);
          });

          const flaggedRows = [];
          const findings = [];
          let flaggedNamesCount = 0;

          Object.keys(nameGroups).forEach(nameNorm => {
            const group = nameGroups[nameNorm];
            
            // Check unique DDO codes first
            const uniqueDdos = new Set();
            group.forEach(r => {
              const ddo = String(r[COL_DDO] || '').trim();
              if (ddo) uniqueDdos.add(ddo);
            });
            if (uniqueDdos.size < 2) return; // Must draw from more than 1 DDO

            // Parse and sort by date of payment
            const parsedRows = group.map(r => ({ ...r, parsedDate: bc(r.dateOfPayment) }))
                                    .filter(r => r.parsedDate !== null)
                                    .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
            if (parsedRows.length < 2) return;

            // Smart logic check:
            // 1. Same-day conflict (group by date)
            const dateGroups = {};
            parsedRows.forEach(r => {
              const dtKey = r.parsedDate.getTime();
              if (!dateGroups[dtKey]) dateGroups[dtKey] = [];
              dateGroups[dtKey].push(r);
            });

            const sameDayDetails = [];
            let hasSameDayConflict = false;
            Object.keys(dateGroups).forEach(dtKey => {
              const rowsOnDate = dateGroups[dtKey];
              const ddosOnDate = new Set(rowsOnDate.map(r => String(r[COL_DDO] || '').trim()));
              if (ddosOnDate.size > 1) {
                hasSameDayConflict = true;
                const dateStr = formatDate(rowsOnDate[0].dateOfPayment);
                sameDayDetails.push(`${dateStr} (DDOs: ${Array.from(ddosOnDate).join(", ")})`);
              }
            });

            // 2. Interleaved DDOs (date jumps back)
            let hasInterleaving = false;
            const interleavingDetails = [];
            const ddos = parsedRows.map(r => String(r[COL_DDO] || '').trim());
            const reportedTriplets = new Set();

            // v2.3 D-1: O(n) interleaving detection (replaces O(n³) triple-nested loop)
            // Detects A→B→A pattern: a DDO revisited after visiting a different DDO
            {
              const _exitedDdos = new Set();
              let _prevDdo = ddos.length > 0 ? ddos[0] : null;
              for (let _di = 1; _di < ddos.length; _di++) {
                if (ddos[_di] !== _prevDdo) {
                  _exitedDdos.add(_prevDdo);
                  if (_exitedDdos.has(ddos[_di])) {
                    hasInterleaving = true;
                    const _dPrev = formatDate(parsedRows[_di - 1].dateOfPayment);
                    const _dCurr = formatDate(parsedRows[_di].dateOfPayment);
                    const detailStr = `DDO ${_prevDdo} → DDO ${ddos[_di - 1]} on ${_dPrev} → DDO ${ddos[_di]} on ${_dCurr} (returned)`;
                    if (!reportedTriplets.has(detailStr)) {
                      reportedTriplets.add(detailStr);
                      interleavingDetails.push(detailStr);
                    }
                  }
                  _prevDdo = ddos[_di];
                }
              }
            }

            if (hasSameDayConflict || hasInterleaving) {
              flaggedNamesCount++;
              
              const uniqueDdoNames = new Set();
              group.forEach(r => {
                const ddoName = String(r[COL_DDO_NAME] || '').trim();
                if (ddoName) uniqueDdoNames.add(ddoName);
              });
              
              const ddosStr = Array.from(uniqueDdos).join(", ");
              const ddoNamesStr = Array.from(uniqueDdoNames).join(" | ");
              const totalAmt = group.reduce((sum, r) => sum + (r[COL_AMT] || 0), 0);
              
              const conflictParts = [];
              if (sameDayDetails.length > 0) {
                const limitedSameDay = sameDayDetails.slice(0, 3);
                const suffix = sameDayDetails.length > 3 ? " (+ more)" : "";
                conflictParts.push(`Same-Day conflicts: [${limitedSameDay.join("; ")}${suffix}]`);
              }
              if (interleavingDetails.length > 0) {
                const limitedInterleaving = interleavingDetails.slice(0, 3);
                const suffix = interleavingDetails.length > 3 ? " (+ more)" : "";
                conflictParts.push(`DDO Jump-backs: [${limitedInterleaving.join("; ")}${suffix}]`);
              }
              const detailsStr = conflictParts.join(" & ");

              let reason = "";
              if (hasSameDayConflict && hasInterleaving) {
                reason = `Same beneficiary name ('${group[0][COL_NAME]}') drawing PAY BILL from multiple DDOs concurrently on same day & DDO code jumps back/interleaves. DDOs: ${ddosStr}. Details: ${detailsStr}`;
              } else if (hasSameDayConflict) {
                reason = `Same beneficiary name ('${group[0][COL_NAME]}') drawing PAY BILL from multiple DDOs concurrently on the same day. DDOs: ${ddosStr}. Details: ${detailsStr}`;
              } else {
                reason = `DDO code jumps back/interleaves for same beneficiary name ('${group[0][COL_NAME]}') drawing PAY BILL from multiple DDOs (e.g. transfers/arrears conflict). DDOs: ${ddosStr}. Details: ${detailsStr}`;
              }

              group.forEach(r => {
                const formatted = formatOutputRow(r, "Flagged: Same Name Multi-DDO Pay Bill", reason);
                formatted.Why_Flagged = reason;
                formatted.AUDIT_ISSUE = reason;
                formatted.Risk_Score = 65;
                formatted.Duplicate_Group = nameNorm;
                flaggedRows.push(formatted);
              });

              findings.push({
                Beneficiary_Name: group[0][COL_NAME],
                DDO_Count: uniqueDdos.size,
                DDO_Codes: ddosStr,
                DDO_Names: ddoNamesStr,
                Total_Amount: `₹${formatIndianCurrency(totalAmt)}`,
                Payment_Count: group.length,
                Severity: "WARNING",
                Risk_Score: 65
              });
            }
          });

          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const timeA = (bc(a.Date) || new Date(0)).getTime();
            const timeB = (bc(b.Date) || new Date(0)).getTime();
            return timeA - timeB;
          });
          findings.sort((a, b) => {
            const valA = parseFloat(a.Total_Amount.replace(/[^0-9.-]+/g,"")) || 0;
            const valB = parseFloat(b.Total_Amount.replace(/[^0-9.-]+/g,"")) || 0;
            return valB - valA;
          });

          const summary = flaggedNamesCount > 0
            ? `🚨 Same Name Multi-DDO Pay Bill: Found ${flaggedNamesCount} names drawing Pay Bills from multiple DDOs with interleaving/same-day conflicts`
            : `✅ No names found drawing Pay Bills from multiple DDOs with interleaving/same-day conflicts`;

          return {
            data: flaggedRows,
            irregularFields: ["Beneficiary_Name", "DDO_Code", "DDO_Name"],
            findings: findings,
            summary: summary
          };
        }

        function run_flag_same_account_multi_ddo_paybill(records) {
          const COL_ACC = "accountNo";
          const COL_DDO = "ddoCode";
          const COL_DDO_NAME = "ddoName";
          const COL_AMT = "amountPaid";

          const accGroups = {};
          records.forEach(r => {
            if (!isPayBillRow(r)) return;
            const acc = ii(r[COL_ACC]);
            if (!acc) return;

            if (!accGroups[acc]) {
              accGroups[acc] = [];
            }
            accGroups[acc].push(r);
          });

          const flaggedRows = [];
          const findings = [];
          let flaggedAccountsCount = 0;

          Object.keys(accGroups).forEach(acc => {
            const group = accGroups[acc];
            
            // Check unique DDO codes first
            const uniqueDdos = new Set();
            group.forEach(r => {
              const ddo = String(r[COL_DDO] || '').trim();
              if (ddo) uniqueDdos.add(ddo);
            });
            if (uniqueDdos.size < 2) return; // Must draw from more than 1 DDO

            // Parse and sort by date of payment
            const parsedRows = group.map(r => ({ ...r, parsedDate: bc(r.dateOfPayment) }))
                                    .filter(r => r.parsedDate !== null)
                                    .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
            if (parsedRows.length < 2) return;

            // Smart logic check:
            // 1. Same-day conflict (group by date)
            const dateGroups = {};
            parsedRows.forEach(r => {
              const dtKey = r.parsedDate.getTime();
              if (!dateGroups[dtKey]) dateGroups[dtKey] = [];
              dateGroups[dtKey].push(r);
            });

            const sameDayDetails = [];
            let hasSameDayConflict = false;
            Object.keys(dateGroups).forEach(dtKey => {
              const rowsOnDate = dateGroups[dtKey];
              const ddosOnDate = new Set(rowsOnDate.map(r => String(r[COL_DDO] || '').trim()));
              if (ddosOnDate.size > 1) {
                hasSameDayConflict = true;
                const dateStr = formatDate(rowsOnDate[0].dateOfPayment);
                sameDayDetails.push(`${dateStr} (DDOs: ${Array.from(ddosOnDate).join(", ")})`);
              }
            });

            // 2. Interleaved DDOs (date jumps back)
            let hasInterleaving = false;
            const interleavingDetails = [];
            const ddos = parsedRows.map(r => String(r[COL_DDO] || '').trim());
            const reportedTriplets = new Set();

            // v2.3 D-1: O(n) interleaving detection (replaces O(n³) triple-nested loop)
            // Detects A→B→A pattern: a DDO revisited after visiting a different DDO
            {
              const _exitedDdos = new Set();
              let _prevDdo = ddos.length > 0 ? ddos[0] : null;
              for (let _di = 1; _di < ddos.length; _di++) {
                if (ddos[_di] !== _prevDdo) {
                  _exitedDdos.add(_prevDdo);
                  if (_exitedDdos.has(ddos[_di])) {
                    hasInterleaving = true;
                    const _dPrev = formatDate(parsedRows[_di - 1].dateOfPayment);
                    const _dCurr = formatDate(parsedRows[_di].dateOfPayment);
                    const detailStr = `DDO ${_prevDdo} → DDO ${ddos[_di - 1]} on ${_dPrev} → DDO ${ddos[_di]} on ${_dCurr} (returned)`;
                    if (!reportedTriplets.has(detailStr)) {
                      reportedTriplets.add(detailStr);
                      interleavingDetails.push(detailStr);
                    }
                  }
                  _prevDdo = ddos[_di];
                }
              }
            }

            if (hasSameDayConflict || hasInterleaving) {
              flaggedAccountsCount++;
              
              const uniqueDdoNames = new Set();
              group.forEach(r => {
                const ddoName = String(r[COL_DDO_NAME] || '').trim();
                if (ddoName) uniqueDdoNames.add(ddoName);
              });
              
              const ddosStr = Array.from(uniqueDdos).join(", ");
              const ddoNamesStr = Array.from(uniqueDdoNames).join(" | ");
              const totalAmt = group.reduce((sum, r) => sum + (r[COL_AMT] || 0), 0);
              
              const conflictParts = [];
              if (sameDayDetails.length > 0) {
                const limitedSameDay = sameDayDetails.slice(0, 3);
                const suffix = sameDayDetails.length > 3 ? " (+ more)" : "";
                conflictParts.push(`Same-Day conflicts: [${limitedSameDay.join("; ")}${suffix}]`);
              }
              if (interleavingDetails.length > 0) {
                const limitedInterleaving = interleavingDetails.slice(0, 3);
                const suffix = interleavingDetails.length > 3 ? " (+ more)" : "";
                conflictParts.push(`DDO Jump-backs: [${limitedInterleaving.join("; ")}${suffix}]`);
              }
              const detailsStr = conflictParts.join(" & ");

              let reason = "";
              if (hasSameDayConflict && hasInterleaving) {
                reason = `Same bank account (${acc}) drawing PAY BILL from multiple DDOs concurrently on same day & DDO code jumps back/interleaves. DDOs: ${ddosStr}. Details: ${detailsStr}`;
              } else if (hasSameDayConflict) {
                reason = `Same bank account (${acc}) drawing PAY BILL from multiple DDOs concurrently on the same day. DDOs: ${ddosStr}. Details: ${detailsStr}`;
              } else {
                reason = `DDO code jumps back/interleaves for same bank account (${acc}) drawing PAY BILL from multiple DDOs (e.g. transfers/arrears conflict). DDOs: ${ddosStr}. Details: ${detailsStr}`;
              }

              group.forEach(r => {
                const formatted = formatOutputRow(r, "Flagged: Same Account Multi-DDO Pay Bill", reason);
                formatted.Why_Flagged = reason;
                formatted.AUDIT_ISSUE = reason;
                formatted.Risk_Score = 75;
                formatted.Duplicate_Group = acc;
                flaggedRows.push(formatted);
              });

              findings.push({
                Account_No: acc,
                DDO_Count: uniqueDdos.size,
                DDO_Codes: ddosStr,
                DDO_Names: ddoNamesStr,
                Total_Amount: `₹${formatIndianCurrency(totalAmt)}`,
                Payment_Count: group.length,
                Severity: "WARNING",
                Risk_Score: 75
              });
            }
          });

          flaggedRows.sort((a, b) => {
            if (a.Duplicate_Group !== b.Duplicate_Group) {
              return a.Duplicate_Group.localeCompare(b.Duplicate_Group);
            }
            const timeA = (bc(a.Date) || new Date(0)).getTime();
            const timeB = (bc(b.Date) || new Date(0)).getTime();
            return timeA - timeB;
          });
          findings.sort((a, b) => {
            const valA = parseFloat(a.Total_Amount.replace(/[^0-9.-]+/g,"")) || 0;
            const valB = parseFloat(b.Total_Amount.replace(/[^0-9.-]+/g,"")) || 0;
            return valB - valA;
          });

          const summary = flaggedAccountsCount > 0
            ? `🚨 Same Account Multi-DDO Pay Bill: Found ${flaggedAccountsCount} accounts drawing Pay Bills from multiple DDOs with interleaving/same-day conflicts`
            : `✅ No accounts found drawing Pay Bills from multiple DDOs with interleaving/same-day conflicts`;

          return {
            data: flaggedRows,
            irregularFields: ["Account_No", "DDO_Code", "DDO_Name"],
            findings: findings,
            summary: summary
          };
        }

function run_flag_paybill_duplicate_monthly(records) {
  const COL_ACC = "accountNo";
  const COL_AMT = "amountPaid";
  
  // Group records by normalized account and month-year
  const groups = {};
  records.forEach(r => {
    if (!isPayBillRow(r)) return;
    const acc = ii(r[COL_ACC]);
    if (!acc) return;
    
    const month = String(r.month || r.paymentMonth || r.voucherDetails?.fyMonth || '').trim().toUpperCase();
    const year = String(r.year || r.paymentYear || r.voucherDetails?.fyYear || '').trim();
    if (!month || !year) return;
    
    const key = `${acc}|${year}|${month}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });
  
  const flaggedRows = [];
  const findings = [];
  let duplicateAccountsCount = 0;
  
  const groupMinDates = {};
  Object.keys(groups).forEach(key => {
    const group = groups[key];
    if (group.length < 2) return;
    const times = group.map(r => bc(r.dateOfPayment)).filter(d => d !== null).map(d => d.getTime());
    groupMinDates[key] = times.length > 0 ? Math.min(...times) : 0;
  });

  Object.keys(groups).forEach(key => {
    const group = groups[key];
    if (group.length < 2) return; // Must occur more than once in the same month
    
    duplicateAccountsCount++;
    const [acc, year, month] = key.split('|');
    const totalAmt = group.reduce((sum, r) => sum + (r[COL_AMT] || 0), 0);
    const dupGroupLabel = `${acc}_${year}_${month}`;
    const minTime = groupMinDates[key] || 0;
    
    // Sort group chronologically for details reporting
    const parsedRows = group.map(r => ({ ...r, parsedDate: bc(r.dateOfPayment) }))
                            .filter(r => r.parsedDate !== null)
                            .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
    
    const dateListStr = parsedRows.map(r => formatDate(r.dateOfPayment)).join(", ");
    
    // Dynamic Risk Factors
    const uniqueNames = new Set(group.map(r => String(r.partyName || r.Beneficiary_Name || '').trim().toUpperCase()));
    const uniqueDdos = new Set(group.map(r => String(r.ddoCode || r.DDO_Code || '').trim().toUpperCase()));
    
    let baseRisk = 75;
    let riskReasons = [];
    
    if (uniqueNames.size > 1) {
      baseRisk = 95;
      riskReasons.push("Ghost Employee (Multiple beneficiary names mapped to same account)");
    } else if (uniqueDdos.size > 1) {
      baseRisk = 90;
      riskReasons.push("Multi-Department Drawing (Payments drawn from multiple different DDOs)");
    }
    
    const hasSunday = group.some(r => {
      const d = bc(r.dateOfPayment);
      return d && d.getDay() === 0;
    });
    if (hasSunday) {
      baseRisk = Math.max(baseRisk, 80);
      riskReasons.push("Includes payment date on Sunday");
    }
    
    // UTR Validity Check: if any transaction has an invalid or empty UTR, demote to low risk
    const allHaveUtri = group.every(r => isValidUTR(r.utrNo)); // D-6: normalized at entry
    if (!allHaveUtri) {
      baseRisk = 30; // Demote to low risk (Failed/re-initiated transaction)
      riskReasons.push("Pending/Failed transaction re-initiated - Low Risk");
    }
    
    const riskSuffix = riskReasons.length > 0 ? ` | Risk Factors: ${riskReasons.join("; ")}` : "";
    const reason = `Bank account (${acc}) received ${group.length} PAY BILL payments in ${month} ${year} on dates: [${dateListStr}]${riskSuffix}`;
    
    group.forEach(r => {
      const formatted = formatOutputRow(r, "Flagged: Duplicate Pay Bill in Month", reason);
      formatted.Why_Flagged = reason;
      formatted.AUDIT_ISSUE = reason;
      formatted.Risk_Score = baseRisk;
      formatted.Duplicate_Group = dupGroupLabel;
      formatted.Min_Date_Time = minTime;
      flaggedRows.push(formatted);
    });
    
    findings.push({
      Account_No: acc,
      Month: month,
      Year: year,
      Payment_Count: group.length,
      Total_Amount: `₹${formatIndianCurrency(totalAmt)}`,
      Dates: dateListStr,
      Severity: baseRisk >= 90 ? "HIGH_RISK" : (baseRisk >= 70 ? "WARNING" : "INFO"),
      Risk_Score: baseRisk
    });
  });
  
  flaggedRows.sort((a, b) => {
    if (a.Min_Date_Time !== b.Min_Date_Time) {
      return a.Min_Date_Time - b.Min_Date_Time;
    }
    if (a.Duplicate_Group !== b.Duplicate_Group) {
      return String(a.Duplicate_Group || '').localeCompare(String(b.Duplicate_Group || ''));
    }
    const timeA = (bc(a.Date) || new Date(0)).getTime();
    const timeB = (bc(b.Date) || new Date(0)).getTime();
    return timeA - timeB;
  });
  
  findings.sort((a, b) => {
    const valA = parseFloat(a.Total_Amount.replace(/[^0-9.-]+/g,"")) || 0;
    const valB = parseFloat(b.Total_Amount.replace(/[^0-9.-]+/g,"")) || 0;
    return valB - valA;
  });
  
  const summary = duplicateAccountsCount > 0
    ? `🚨 Duplicate Pay Bill in Month: Found ${duplicateAccountsCount} accounts receiving multiple Pay Bills in the same month`
    : `✅ No accounts found drawing multiple Pay Bills in the same month`;
    
  return {
    data: flaggedRows,
    irregularFields: ["Account_No", "Month", "Year", "Date"],
    findings: findings,
    summary: summary
  };
}

function run_flag_paybill_duplicate_amount_monthly(records) {
  const COL_ACC = "accountNo";
  const COL_AMT = "amountPaid";
  
  // Group records by normalized account, month-year, and amount
  const groups = {};
  records.forEach(r => {
    if (!isPayBillRow(r)) return;
    const acc = ii(r[COL_ACC]);
    if (!acc) return;
    
    const month = String(r.month || r.paymentMonth || r.voucherDetails?.fyMonth || '').trim().toUpperCase();
    const year = String(r.year || r.paymentYear || r.voucherDetails?.fyYear || '').trim();
    if (!month || !year) return;
    
    const amt = Number(r[COL_AMT] || 0);
    if (amt <= 0) return;
    
    const key = `${acc}|${year}|${month}|${amt}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });
  
  const flaggedRows = [];
  const findings = [];
  let duplicateAccountsCount = 0;
  
  const groupMinDates = {};
  Object.keys(groups).forEach(key => {
    const group = groups[key];
    if (group.length < 2) return;
    const times = group.map(r => bc(r.dateOfPayment)).filter(d => d !== null).map(d => d.getTime());
    groupMinDates[key] = times.length > 0 ? Math.min(...times) : 0;
  });

  Object.keys(groups).forEach(key => {
    const group = groups[key];
    if (group.length < 2) return; // Must occur more than once in the same month
    
    duplicateAccountsCount++;
    const [acc, year, month, amt] = key.split('|');
    const totalAmt = group.reduce((sum, r) => sum + (r[COL_AMT] || 0), 0);
    const dupGroupLabel = `${acc}_${year}_${month}_${amt}`;
    const minTime = groupMinDates[key] || 0;
    
    // Sort group chronologically for details reporting
    const parsedRows = group.map(r => ({ ...r, parsedDate: bc(r.dateOfPayment) }))
                            .filter(r => r.parsedDate !== null)
                            .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
    
    const dateListStr = parsedRows.map(r => formatDate(r.dateOfPayment)).join(", ");
    
    // Dynamic Risk Factors
    const uniqueNames = new Set(group.map(r => String(r.partyName || r.Beneficiary_Name || '').trim().toUpperCase()));
    const uniqueDdos = new Set(group.map(r => String(r.ddoCode || r.DDO_Code || '').trim().toUpperCase()));
    
    let baseRisk = 85; // Base risk for same amount duplicates is higher (85)
    let riskReasons = [];
    
    if (uniqueNames.size > 1) {
      baseRisk = 95;
      riskReasons.push("Ghost Employee (Multiple beneficiary names mapped to same account)");
    } else if (uniqueDdos.size > 1) {
      baseRisk = 90;
      riskReasons.push("Multi-Department Drawing (Payments drawn from multiple different DDOs)");
    }
    
    const hasSunday = group.some(r => {
      const d = bc(r.dateOfPayment);
      return d && d.getDay() === 0;
    });
    if (hasSunday) {
      baseRisk = Math.max(baseRisk, 88);
      riskReasons.push("Includes payment date on Sunday");
    }
    
    // UTR Validity Check: if any transaction has an invalid or empty UTR, demote to low risk
    const allHaveUtri = group.every(r => isValidUTR(r.utrNo)); // D-6: normalized at entry
    if (!allHaveUtri) {
      baseRisk = 30; // Demote to low risk (Failed/re-initiated transaction)
      riskReasons.push("Pending/Failed transaction re-initiated - Low Risk");
    }
    
    const riskSuffix = riskReasons.length > 0 ? ` | Risk Factors: ${riskReasons.join("; ")}` : "";
    const reason = `Bank account (${acc}) received ${group.length} PAY BILL payments of same amount (₹${formatIndianCurrency(Number(amt))}) in ${month} ${year} on dates: [${dateListStr}]${riskSuffix}`;
    
    group.forEach(r => {
      const formatted = formatOutputRow(r, "Flagged: Duplicate Pay Bill Amount in Month", reason);
      formatted.Why_Flagged = reason;
      formatted.AUDIT_ISSUE = reason;
      formatted.Risk_Score = baseRisk;
      formatted.Duplicate_Group = dupGroupLabel;
      formatted.Min_Date_Time = minTime;
      flaggedRows.push(formatted);
    });
    
    findings.push({
      Account_No: acc,
      Month: month,
      Year: year,
      Amount: `₹${formatIndianCurrency(Number(amt))}`,
      Payment_Count: group.length,
      Total_Amount: `₹${formatIndianCurrency(totalAmt)}`,
      Dates: dateListStr,
      Severity: baseRisk >= 90 ? "HIGH_RISK" : (baseRisk >= 70 ? "WARNING" : "INFO"),
      Risk_Score: baseRisk
    });
  });
  
  flaggedRows.sort((a, b) => {
    if (a.Min_Date_Time !== b.Min_Date_Time) {
      return a.Min_Date_Time - b.Min_Date_Time;
    }
    if (a.Duplicate_Group !== b.Duplicate_Group) {
      return String(a.Duplicate_Group || '').localeCompare(String(b.Duplicate_Group || ''));
    }
    const timeA = (bc(a.Date) || new Date(0)).getTime();
    const timeB = (bc(b.Date) || new Date(0)).getTime();
    return timeA - timeB;
  });
  
  findings.sort((a, b) => {
    const valA = parseFloat(a.Total_Amount.replace(/[^0-9.-]+/g,"")) || 0;
    const valB = parseFloat(b.Total_Amount.replace(/[^0-9.-]+/g,"")) || 0;
    return valB - valA;
  });
  
  const summary = duplicateAccountsCount > 0
    ? `🚨 Duplicate Pay Bill Amount in Month: Found ${duplicateAccountsCount} accounts receiving multiple Pay Bills of same amount in the same month`
    : `✅ No accounts found drawing multiple Pay Bills of same amount in the same month`;
    
  return {
    data: flaggedRows,
    irregularFields: ["Account_No", "Month", "Year", "Amount", "Date"],
    findings: findings,
    summary: summary
  };
}

function run_paybill_scholarship(records) {
  return runConflictCheck(records, ["Pay Bill"], ["Grant", "Scholarship"], "Pay Bill + Grant/Scholarship", "Same account paid via both Pay Bill and Grant/Scholarship", "Pay Bill", "Grant/Scholarship");
}

function run_pension_scholarship(records) {
  return runConflictCheck(records, ["Pension"], ["Scholarship"], "Pension + Scholarship", "Same account paid via both Pension and Scholarship", "Pension", "Scholarship");
}

function run_pension_fvc(records) {
  return runConflictCheck(records, ["Pension"], ["FVC"], "Pension + FVC", "Same account paid via both Pension and FVC", "Pension", "FVC");
}

function run_merged_pol(records) {
  const dateMap = new Map();
  const parseFn = typeof window !== 'undefined' ? window.parseDDMMYYYY : (typeof self !== 'undefined' ? self.parseDDMMYYYY : null);
  for (const r of records) {
    let t = 0;
    if (r.dateOfPayment) {
      if (r.dateOfPayment instanceof Date) {
        t = isNaN(r.dateOfPayment.getTime()) ? 0 : r.dateOfPayment.getTime();
      } else {
        const d = parseFn ? parseFn(r.dateOfPayment) : new Date(r.dateOfPayment);
        t = isNaN(d.getTime()) ? 0 : d.getTime();
      }
    }
    dateMap.set(r, t);
  }
  
  const sorted = [...records].sort((a, b) => {
    if (a.sourceFile !== b.sourceFile) {
      return String(a.sourceFile || '').localeCompare(String(b.sourceFile || ''));
    }
    const tA = dateMap.get(a) || 0;
    const tB = dateMap.get(b) || 0;
    return tA - tB;
  });
  
  const uniqueFiles = new Set(records.map(r => r.sourceFile)).size;
  const totalAmt = records.reduce((s, r) => s + (r.amountPaid || 0), 0);
  
  return {
    data: sorted.map(r => formatOutputRow(r)),
    irregularFields: [],
    findings: [],
    summary: `ℹ️ Total ${records.length.toLocaleString()} records from ${uniqueFiles} files (₹${(totalAmt/1e7).toFixed(2)} Cr)`
  };
}

function run_flag_29_high_paybill(records) {
  const limit = Number(getSetting('paybill_high_value_limit', 200000));
  const flaggedRows = [];
  let matchCount = 0;
  let totalAmt = 0;
  
  records.forEach(r => {
    if (!isPayBillRow(r)) return;
    const amt = Number(r.amountPaid);
    if (isNaN(amt) || amt <= limit) return;
    
    matchCount++;
    totalAmt += amt;
    const reason = `Individual PAY BILL payment amount (₹${formatIndianCurrency(amt)}) exceeds the safety limit of ₹${formatIndianCurrency(limit)}`;
    const formatted = formatOutputRow(r, "Flagged: High-Value PAY BILL Payment", reason);
    formatted.Why_Flagged = reason;
    formatted.AUDIT_ISSUE = reason;
    formatted.Risk_Score = amt >= 500000 ? 90 : 75; // Even higher risk if over 5L!
    flaggedRows.push(formatted);
  });
  
  flaggedRows.sort((a, b) => b.Amount - a.Amount); // Highest first!
  
  const uniqueAccounts = new Set(flaggedRows.map(r => r.Account_No)).size;
  
  return {
    data: flaggedRows,
    irregularFields: ["Account_No", "Amount", "Date"],
    findings: [
      { Metric: "Total Payouts Flagged", Value: matchCount.toString() },
      { Metric: "Unique Accounts Involved", Value: uniqueAccounts.toString() },
      { Metric: "Total Amount Involved", Value: `₹${formatIndianCurrency(totalAmt)}` }
    ],
    summary: matchCount > 0 
      ? `🚨 High-Value PAY BILL: Found ${matchCount} payment(s) exceeding safety threshold of ₹${formatIndianCurrency(limit)}`
      : `✅ No PAY BILL payments exceeded the ₹${formatIndianCurrency(limit)} threshold`
  };
}

        // 8. Custom D3 Overrides Object
        // D-6 v2.3.2: _wrapCheck normalizes UTR aliases before each check runs
        function _wrapCheck(fn) {
          return function(records) { return fn(normalizeRecords(records)); };
        }
        self.customD3 = {
          single_acct_multi_ben_fuzzy: run_flag_1,
          multi_party_account: run_flag_2,
          // D-8 v2.3.1: run_flag_3 removed; use flag_3 (run_flag_3_corrected) instead
          dup_amt_party: run_flag_4,
          dup_amt_party_no_limit: run_flag_8b, dup_name_amount: run_flag_6c, dup_acc_amount: run_flag_6d, dup_major_head_2245: run_flag_6e, paybill_excessive_freq: run_flag_paybill_excessive_freq, near_approval_limits: run_flag_approval_limits,
          gpf_dpf_payments: run_flag_9,
          paybill_fvc: run_flag_10,
          paybill_scholarship: function(t) { return runConflictCheck(t, ["Pay Bill"], ["Grant", "Scholarship"], "Pay Bill + Grant/Scholarship", "Same account paid via both Pay Bill and Grant/Scholarship", "Pay Bill", "Grant/Scholarship"); },
          pension_scholarship: function(t) { return runConflictCheck(t, ["Pension"], ["Scholarship"], "Pension + Scholarship", "Same account paid via both Pension and Scholarship", "Pension", "Scholarship"); },
          pension_fvc: function(t) { return runConflictCheck(t, ["Pension"], ["FVC"], "Pension + FVC", "Same account paid via both Pension and FVC", "Pension", "FVC"); },
          post_death_payments: run_dcrg_payments,
          medical_bills: run_medical_bills,
          paybill_duplicate_monthly: run_flag_paybill_duplicate_monthly,
          paybill_duplicate_amount_monthly: run_flag_paybill_duplicate_amount_monthly,
          fvc_below_threshold: run_fvc_below_threshold,
          cross_ddo_same_account: run_cross_ddo_payments,
          flag_3: run_flag_3_corrected,
          ta_bills: run_flag_ta_bills,
          benfords_law: run_flag_benfords_law,
          round_amounts: run_flag_round_amounts,
          same_day: run_flag_same_day,
          rapid_payments: run_flag_rapid_payments,
          cross_ddo: run_flag_cross_ddo,
          inactive_reactivation: run_flag_inactive_reactivation,
          duplicate_utr: run_flag_duplicate_utr,
          same_amt_diff_voucher: run_flag_same_amt_diff_voucher,
          split_billing: run_flag_split_billing,
          cash_payments: run_flag_cash_payments,
          vendor_concentration: run_flag_vendor_concentration,
          paybill_same_acct_diff_party: run_flag_same_account_diff_party_paybill,
          duplicate_voucher_diff_no: run_flag_duplicate_voucher_diff_no,
          approval_limits: run_flag_approval_limits,
          paybill_same_name_multi_ddo: run_flag_same_name_multi_ddo_paybill,
          paybill_same_account_multi_ddo: run_flag_same_account_multi_ddo_paybill,
          paybill_high_value: run_flag_29_high_paybill,
          // ── v2.3 new checks ─────────────────────────────────────
          march_rush_new_account: run_flag_march_rush_new_account,
          annual_vendor_cap:      run_flag_annual_vendor_cap,
          suspicious_names:       run_flag_suspicious_names,
          salary_jump:            run_flag_salary_jump,
          ddo_march_rush:         run_flag_ddo_march_rush,
          // ── v2.3.1 new checks ───────────────────────────────────
          dow_concentration:      run_flag_dow_concentration,
          // ── v2.4 Triage & Convergence checks ────────────────────────
          triage_top_accounts:    run_triage_top_accounts,
          triage_voucher_clusters:run_voucher_clustering,
          ghost_employee_composite:run_ghost_employee_composite,
          vendor_fraud_composite: run_vendor_fraud_composite,
          audit_narratives:       run_audit_narratives
        };
})();