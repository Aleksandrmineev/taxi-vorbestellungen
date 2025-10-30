#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import argparse, re, json, datetime
from pathlib import Path

LINE_RES = [
    # [DD.MM.YY, HH:MM(:SS)] Name: Message
    re.compile(r"^\[\s*(\d{1,2}\.\d{1,2}\.\d{2,4})\s*,\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\]\s*(.+?)\s*:\s*(.*)$"),
    # DD.MM.YY, HH:MM(-SS) – Name: Message   (длинное тире, иногда одно дефис)
    re.compile(r"^\s*(\d{1,2}\.\d{1,2}\.\d{2,4})\s*,?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[–-]\s*(.+?)\s*:\s*(.*)$"),
]

NBSP_RE = re.compile(r"[\u00A0\u202F\u2007]")  # неразрывные/узкие пробелы → обычный пробел
PHONE_RE = re.compile(r"(\+?\d[\d\s().\-]{6,}\d)")
VEH_RE = re.compile(r"\b(\d{2,4}TX|TX\d+|TAXI\s*\d+|TAXI\d+)\b", re.IGNORECASE)
MAP_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
CYRILLIC_RE = re.compile(r"[А-Яа-яЁё]")

# --- новая функция нормализации ---
def normalize_line_spaces(s: str) -> str:
    """Заменяет неразрывные пробелы и лишние табы на обычные."""
    s = NBSP_RE.sub(" ", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s

def load_cfg(cfg_path: Path):
    cfg = {
        "names_trailing": [],
        "fillers": [],
        "tokens": [],
        "cut_after": [".","@"],
        "banned_patterns": [r"^\d+\s*x$"]
    }
    if cfg_path.exists():
        try:
            user_cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
            for k,v in user_cfg.items():
                if isinstance(v, list): cfg[k] = v
        except Exception:
            pass
    # precompile patterns
    cfg["_banned_regex"] = [re.compile(p, re.IGNORECASE) for p in cfg.get("banned_patterns", [])]
    return cfg

def parse_dt(d, t):
    for fmt in ("%d.%m.%y %H:%M:%S", "%d.%m.%y %H:%M", "%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M"):
        try:
            return datetime.datetime.strptime(f"{d} {t}", fmt)
        except ValueError:
            pass
    return None

def normalize_phone_e164(phone_raw):
    pr = phone_raw.strip()
    digits = re.sub(r"\D", "", pr)
    phone_e164 = None
    if pr.startswith("+"):
        phone_e164 = "+" + digits
    elif pr.startswith("0") and len(digits) >= 8:
        phone_e164 = "+43" + digits[1:]
    else:
        if digits.startswith("43"):
            phone_e164 = "+" + digits
        elif len(digits) >= 8:
            phone_e164 = "+" + digits
    return (pr, digits, phone_e164)

def contains_cyrillic(text: str) -> bool:
    return bool(CYRILLIC_RE.search(text or ""))

def strip_mentions(text: str) -> str:
    return re.sub(r"@\S+", "", text or "")

def cut_after_chars(text: str, chars):
    if not text: return text
    pos = min([i for i in [text.find(c) for c in chars] if i != -1], default=-1)
    return text[:pos] if pos != -1 else text

def token_base(tok: str) -> str:
    return re.sub(r"[^\wäöüß]+", "", (tok or "").lower())

def match_banned(tok: str, cfg) -> bool:
    base = token_base(tok)
    if not base: return True  # drop pure punctuation
    if base in set(cfg.get("fillers", [])) or base in set(cfg.get("tokens", [])):
        return True
    for rx in cfg.get("_banned_regex", []):
        if rx.match(base): return True
    return False

def strip_trailing_names(text: str, cfg) -> str:
    if not text: return text
    toks = [t for t in re.split(r"\s+", text.strip()) if t]
    names = set(cfg.get("names_trailing", []))
    fillers = set(cfg.get("fillers", []))
    while toks:
        b = token_base(toks[-1])
        if not b: toks.pop(); continue
        if b in names or b in fillers or b in {"bitte","danke"}:
            toks.pop(); continue
        break
    return " ".join(toks).strip(" ,.-")

def clean_line(text: str, cfg) -> str:
    if not text: return ""
    # 1) Cut after special chars (e.g. '.' or '@')
    text = cut_after_chars(text, cfg.get("cut_after", [".","@"]))
    # 2) Remove mentions leftovers
    text = strip_mentions(text)
    # 3) Remove banned tokens anywhere (fillers, 'und', '2x', etc.)
    toks = [t for t in re.split(r"\s+", text) if t]
    kept = []
    for tok in toks:
        if match_banned(tok, cfg):
            continue
        kept.append(tok)
    text = " ".join(kept)
    # 4) Strip trailing names (driver signatures) and trailing fillers
    text = strip_trailing_names(text, cfg)
    # Cleanup spaces/punct
    text = re.sub(r"\s{2,}", " ", text).strip(" ,.-")
    return text

def looks_like_address(text: str) -> bool:
    if not text: return False
    if contains_cyrillic(text): return False
    low = text.lower()
    if MAP_URL_RE.search(text): return True
    if any(h in low for h in [
        "gh","gasthaus","cafe","ff ","feuerwehr","bahnhof","taxistand","taxi stand","strasse","straße","str.","weg",
        "platz","gasse","hotel","schule","billa","stadion","kirche","hauptstr","hauptstraße","knittelfeld","zeltweg","judenburg",
        "kobenz","spielberg","hintereingang","eingang","parkplatz","arena","bahnstr","eisenbahn","eisenbahnergasse","eisenbahnerring"
    ]):
        return True
    if re.search(r"\d", text) and any(c.isalpha() for c in text):
        return True
    return False

def parse_file(in_path: Path, cfg_path: Path):
    cfg = load_cfg(cfg_path)
    raw = in_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    # Coalesce multiline messages
    coalesced, current = [], None
    unmatched = []  # для диагностики

    for idx, raw_line in enumerate(raw):
        line = normalize_line_spaces(raw_line.rstrip("\n\r"))

        m = None
        groups = None
        for rx in LINE_RES:
            mm = rx.match(line)
            if mm:
                m = rx
                groups = mm.groups()
                break

        if groups:
            d, t, author, msg = groups
            dt = parse_dt(d, t)
            current = {"idx": idx, "dt": dt, "author": author.strip(), "msg": msg.rstrip()}
            coalesced.append(current)
        else:
            if current is not None:
                current["msg"] += "\n" + line.rstrip()
            else:
                # строка не распознана как начало сообщения и нет "текущего" — сохраним в unmatched
                unmatched.append((idx, line))

    # Если надо — пишем «не распознанные» в файл рядом с output
    if unmatched:
        try:
            Path("unmatched_lines.txt").write_text(
                "\n".join(f"{i}: {s}" for i, s in unmatched),
                encoding="utf-8"
            )
        except Exception:
            pass

    records = []
    for item in coalesced:
        msg = item["msg"]
        if VEH_RE.search(msg): 
            continue
        phones = PHONE_RE.findall(msg)
        if not phones:
            continue
        pr, digits, e164 = normalize_phone_e164(phones[0])
        remainder = msg.replace(phones[0], "").strip(" -:\n\r\t")
        parts = [p.strip() for p in remainder.split("\n") if p.strip()]
        address_lines = []
        for p in parts:
            if contains_cyrillic(p): 
                continue
            p2 = clean_line(p, cfg)
            if not p2: 
                continue
            if looks_like_address(p2) or p2:
                address_lines.append(p2)
        address = " ".join(address_lines).strip() or None
        records.append({
            "timestamp_iso": item["dt"].isoformat() if item["dt"] else None,
            "author": item["author"],
            "phone_raw": pr,
            "phone_digits": digits,
            "phone_e164": e164,
            "address": address,
            "source_line": item["idx"],
        })
    records.sort(key=lambda r: (r["timestamp_iso"] or ""), reverse=True)
    return records

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input","-i", default="chat.txt")
    ap.add_argument("--output","-o", default="data.json")
    ap.add_argument("--config","-c", default="stopnames.json")
    args = ap.parse_args()
    in_path = Path(args.input); out_path = Path(args.output); cfg_path = Path(args.config)
    records = parse_file(in_path, cfg_path)
    out_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {len(records)} records → {out_path}")

if __name__ == "__main__":
    main()
