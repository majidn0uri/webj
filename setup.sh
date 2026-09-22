#!/usr/bin/env bash
# =============================================================================
# ست‌شاپ — نصب، راه‌اندازی و اجرا روی کامپیوترِ خودت
# -----------------------------------------------------------------------------
# یک فایل، دو کار: (۱) پیش‌نیازها را تشخیص می‌دهد و اگر نبودند نصب می‌کند،
# (۲) پایگاه‌داده + API + وب را بالا می‌آورد و نشانی‌ها را می‌دهد.
#
#   bash setup.sh                نصب + راه‌اندازی (حالت توسعه)
#   bash setup.sh --prod         ساختِ بهینه و اجرایِ production (همان سرورِ واقعی)
#   bash setup.sh check          فقط بررسیِ پیش‌نیازها (هیچ چیزی نصب/تغییر نمی‌دهد)
#   bash setup.sh install        فقط نصبِ پیش‌نیازها و وابستگی‌ها
#   bash setup.sh db             فقط پایگاه‌داده را بالا بیاورد
#   bash setup.sh status         چه چیزی در حالِ اجراست (سرویس‌ها، پورت‌ها، سلامت)
#   bash setup.sh logs api       لاگِ API (api | web | db | all) — با -f پی‌گیری می‌شود
#   bash setup.sh stop           خاموش کردنِ همه‌چیز
#   bash setup.sh seed           سفارش‌ها و فروشِ نمونه (برایِ اینکه صفحه‌هایِ گزارش عدد نشان دهند)
#
# گزینه‌ها:
#   --prod            نکست با «next build» ساخته و با «next start» اجرا می‌شود
#   --open            پس از بالا آمدن، مرورگر را باز می‌کند
#   --api-port=N      پیش‌فرض ۳۰۰۰
#   --web-port=N      پیش‌فرض ۳۱۰۰
#   --db-url=DSN      به‌کار بردنِ پستگرسِ خودت (خوشه‌یِ جدا نمی‌سازد)
#   --env=FILE        خواندنِ متغیرهایِ محیطیِ اضافه از یک پرونده (کپیِ deploy/env.example)
#   --reset-db        ساختِ دوبارهٔ خوشه‌یِ توسعه (داده‌یِ توسعه می‌رود؛ فقط ~/.setshop/pgdata)
#   --keep-db         در «stop»، پایگاه روشن بماند
#   --with-sales      در پایانِ «run» فروشِ نمونه هم نشانده شود (گزارش‌ها پر می‌شود)
#   -y, --yes         بی‌پرسش (برایِ CI و اجرایِ غیرتعاملی)
#
# متغیرهایِ محیطی (اگر پیش‌فرض‌ها را نمی‌پسندی):
#   SETSHOP_HOME=…    جایِ کلیدها/لاگ‌ها/خوشه (پیش‌فرض ~/.setshop)
#   SETSHOP_PGPORT=…  پورتِ پستگرسِ توسعه (پیش‌فرض 5433) · SETSHOP_PGDATA=… · SETSHOP_PGRUN=…
#   ADMIN_PASSWORD=…  رمزِ مدیر در نخستین ساختِ کاربر (پیش‌فرض SetShop@1404)
#
# قانون‌هایِ طراحی که عمداً رعایت شده:
#   • بی‌خطر برایِ اجرایِ دوباره: هر بار اجرا کنی از همان‌جا ادامه می‌دهد —
#     وابستگیِ نصب‌شده را دوباره نصب نمی‌کند، سرویسِ زنده را دوباره راه
#     نمی‌اندازد، و کاتالوگ را رویِ کالاهایِ ساخته‌شده در پنل نمی‌نشاند.
#   • هیچ رازی در مخزن نمی‌نشیند: کلیدِ امضا، کلیدِ گاوصندوق و توکنِ تماسِ
#     درونی در ~/.setshop ساخته می‌شوند (مجوز ۶۰۰).
#   • پایگاه بیرون از شاخه‌یِ پروژه: خوشه در ~/.setshop/pgdata است، نه در
#     /tmp (که مک و لینوکس گاه پاکش می‌کنند) و نه در /.data (که با هر
#     پاک‌سازیِ مخزن می‌رود).
#   • پورت‌ها همان پیش‌فرض‌هایِ کد است: ۳۰۰۰ برای API، ۳۱۰۰ برای وب، ۵۴۳۳
#     برایِ پستگرس — تا با هر اسکریپتِ دیگری که در مخزن هست (scripts/up.sh،
#     scripts/load-test.mjs) سازگار بماند.
#
# لازم‌ها: bash، curl، Node ۲۰.۱۱ یا تازه‌تر، و PostgreSQL (که این اسکریپت
# می‌تواند نصبش کند). اینترنت فقط برایِ نصبِ نخستین لازم است — خودِ سایت هیچ
# دارایی از بیرون بارگذاری نمی‌کند.
# =============================================================================
set -uo pipefail

# ─── رنگ و چاپ ────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_B=$'\e[1m'; C_0=$'\e[0m'
else C_OK=""; C_WARN=""; C_ERR=""; C_B=""; C_0=""; fi
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$C_OK" "$C_0" "$*"; }
warn() { printf '%s!%s %s\n' "$C_WARN" "$C_0" "$*"; }
die()  { printf '%s✗ %s%s\n' "$C_ERR" "$*" "$C_0" >&2; exit 1; }
step() { printf '\n%s— %s%s\n' "$C_B" "$*" "$C_0"; }

# راهنما از همان سرِ پرونده خوانده می‌شود (میانِ دو خطِ =====): یک منبعِ حقیقت،
# پس اگر گزینه‌ای اضافه کردی، راهنما خودبه‌خود درست می‌ماند.
usage() { awk 'NR>2 { if ($0 ~ /^# ={20,}/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

confirm() {
  [[ "${YES:-0}" == "1" ]] && return 0
  [[ -t 0 ]] || return 1
  printf '%s [y/N] ' "$1"
  local a; read -r a || return 1
  case "$a" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# ─── مسیرها و پیش‌فرض‌ها ───────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$(basename "${BASH_SOURCE[0]}")"   # نامِ خودِ اسکریپت، برایِ پیام‌ها
STATE_DIR="${SETSHOP_HOME:-$HOME/.setshop}"        # رازها، لاگ‌ها، pid
LOG_DIR="$STATE_DIR/logs"
PID_DIR="$STATE_DIR/run"
TOKEN_FILE="$STATE_DIR/internal-api-token"        # وب → API (معافیتِ سقفِ حاشیه‌ای)
MASTER_FILE="$STATE_DIR/master-key"               # کلیدِ گاوصندوقِ گواهیِ مؤدیان

API_PORT="${API_PORT:-3000}"
WEB_PORT="${WEB_PORT:-3100}"
PGPORT="${SETSHOP_PGPORT:-5433}"                  # ۵۴۳۲ برایِ پستگرسِ خودت خالی می‌ماند
PGUSER="${SETSHOP_PGUSER:-setshop}"
PGDB="${SETSHOP_PGDB:-setshop}"
PGDATA="${SETSHOP_PGDATA:-$STATE_DIR/pgdata}"
PGRUN="${SETSHOP_PGRUN:-$STATE_DIR/pgrun}"
NODE_MIN_MAJOR=20; NODE_MIN_MINOR=11; NODE_MIN_PATCH=0

MODE="dev"; OPEN=0; YES=0; RESET_DB=0; STOP_DB=1; DB_MODE="private"; WITH_SALES=0
EXTRA_ENV=""
CMD="run"
LOG_TARGET="all"; LOG_FOLLOW=0

# ─── استدلال‌هایِ فرمان ───────────────────────────────────────────────────────
log_target_given=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    run|start|up)     CMD="run" ;;
    install|deps)     CMD="install" ;;
    check|doctor)     CMD="check" ;;
    db)               CMD="db" ;;
    seed)             CMD="seed" ;;
    status)           CMD="status" ;;
    logs)             CMD="logs"; log_target_given=1 ;;
    stop|down)        CMD="stop" ;;
    -f|--follow)      LOG_FOLLOW=1 ;;
    api|web|db|pg|all) LOG_TARGET="$1" ;;
    --prod)           MODE="prod" ;;
    --open)           OPEN=1 ;;
    -y|--yes)         YES=1 ;;
    --reset-db)       RESET_DB=1 ;;
    --keep-db)        STOP_DB=0 ;;
    --with-sales)     WITH_SALES=1 ;;
    --api-port=*)     API_PORT="${1#*=}" ;;
    --web-port=*)     WEB_PORT="${1#*=}" ;;
    --db-url=*)       DB_URL="${1#*=}" ;;
    --env=*)          EXTRA_ENV="${1#*=}" ;;
    -h|--help)        CMD="help" ;;
    *) if [[ "$log_target_given" == "1" ]]; then LOG_TARGET="$1"; log_target_given=0;
        else die "گزینه‌یِ ناشناخته: $1  (راهنما: bash $SELF --help)"; fi ;;
  esac
  shift
done

# API_BASE را وب می‌خواند (rewrite در next.config.mjs)؛ همان مقداری که خودِ کد
# پیش‌فرض می‌گیرد را صریح می‌دهیم تا تغییرِ پورتِ API، وب را به مقصدِ اشتباه نزند.
export API_PORT WEB_PORT
API_BASE="http://127.0.0.1:${API_PORT}"
export API_BASE

# ─── ابزارهایِ کوچک ───────────────────────────────────────────────────────────
SUDO=""
if [[ "$(id -u)" != "0" ]] && need_cmd sudo; then
  SUDO="sudo"; [[ "$YES" == "1" ]] && SUDO="sudo -n"
fi

node_v() { node -p 'process.versions.node' 2>/dev/null; }
node_is_old() {
  local v maj min pat
  v="$(node_v)" || return 0
  [[ -z "$v" ]] && return 0
  IFS=. read -r maj min pat <<<"$v"
  pat="${pat%%[!0-9]*}"; [[ -z "$pat" ]] && pat=0
  (( ${maj:-0} < NODE_MIN_MAJOR )) && return 0
  (( ${maj:-0} == NODE_MIN_MAJOR && ${min:-0} < NODE_MIN_MINOR )) && return 0
  (( ${maj:-0} == NODE_MIN_MAJOR && ${min:-0} == NODE_MIN_MINOR && ${pat:-0} < NODE_MIN_PATCH )) && return 0
  return 1
}

# پستگرس روی مک «keg-only» است (در PATH نمی‌آید) و روی لینوکس در
# /usr/lib/postgresql/<نسخه>/bin می‌نشیند؛ پس فهرستِ نامزدها را می‌سازیم.
PGBINS=()
build_pg_candidates() {
  PGBINS=()
  local d p v bp
  [[ -n "${PGBIN:-}" ]] && { [[ -x "$PGBIN/initdb" ]] && PGBINS+=("$PGBIN"); return 0; }
  for d in /usr/lib/postgresql/*/bin /usr/pgsql-*/bin /usr/geo/bin /opt/postgresql/*/bin; do
    [[ -x "$d/initdb" ]] && PGBINS+=("$d")
  done
  if need_cmd brew; then
    for v in 18 17 16 15 14; do
      bp="$(brew --prefix "postgresql@$v" 2>/dev/null || true)"
      [[ -n "$bp" && -x "$bp/bin/initdb" ]] && PGBINS+=("$bp/bin")
    done
    bp="$(brew --prefix postgresql 2>/dev/null || true)"
    [[ -n "$bp" && -x "$bp/bin/initdb" ]] && PGBINS+=("$bp/bin")
  fi
  if need_cmd pg_ctl; then
    d="$(cd "$(dirname "$(command -v pg_ctl)")" && pwd)"
    [[ -x "$d/initdb" ]] && PGBINS+=("$d")
  fi
  return 0
}
pgbin() { [[ ${#PGBINS[@]} -gt 0 ]] && printf '%s' "${PGBINS[0]}"; }
pgtool() { local b; b="$(pgbin)"; if [[ -n "$b" && -x "$b/$1" ]]; then printf '%s' "$b/$1"; else command -v "$1" 2>/dev/null; fi; }

# ابزارهایِ نگاه‌کردنِ پورت. روی مک lsof هست و روی لینوکس ممکن است تنها ss
# باشد (و pid را هم فقط از فرآیندهایِ خودِ کاربر نشان می‌دهد)؛ پس هر سه راه
# امتحان می‌شود و نبودِ هیچ‌کدام خطا نیست — فقط «نمی‌دانم» را برمی‌گرداند.
port_pid() { # شناسهٔ نخستینِ فرآیندی که روی پورت گوش می‌دهد (خالی = آزاد/نامعلوم)
  local p="$1" line
  if need_cmd lsof; then lsof -nP -iTCP:"$p" -sTCP:LISTEN -t 2>/dev/null | head -1; return 0; fi
  if need_cmd fuser; then fuser -n tcp "$p" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' | head -1; return 0; fi
  if need_cmd ss; then
    line="$(ss -ltnp 2>/dev/null | grep -E "[:.]${p}[[:space:]]" | head -1)"
    printf '%s' "${line}" | sed -nE 's/.*pid=([0-9]+).*/\1/p'
    return 0
  fi
  return 0
}
port_free() {
  local p="$1"
  if need_cmd lsof; then ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; return 0; fi
  if need_cmd ss; then ss -ltn 2>/dev/null | grep -Eq "[:.]${p}[[:space:]]" && return 1; return 0; fi
  return 0
}

alive() { local f="$PID_DIR/$1.pid"; [[ -f "$f" ]] && kill -0 "$(cat "$f" 2>/dev/null)" 2>/dev/null; }

# نکست و tsx فرزند می‌سازند؛ کشتنِ pidِ تنها، یتیم‌ها را رویِ پورت نگه می‌دارد
descendants() {
  local p="$1" c
  for c in $(pgrep -P "$p" 2>/dev/null); do descendants "$c"; done
  printf '%s\n' "$p"
}
kill_tree() {
  local p="$1" sig="${2:-TERM}" c
  for c in $(descendants "$p"); do kill -"$sig" "$c" 2>/dev/null || true; done
  kill -"$sig" "$p" 2>/dev/null || true
}
stop_service() {
  local name="$1" f="$PID_DIR/$1.pid" pid
  [[ -f "$f" ]] || return 0
  pid="$(cat "$f" 2>/dev/null)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill_tree "$pid" TERM
    for _ in 1 2 3 4 5 6 7 8; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -0 "$pid" 2>/dev/null && kill_tree "$pid" KILL
    ok "خاموش شد: $name"
  fi
  rm -f "$f"
}

_read_key() { # خواندنِ کلیدِ تک‌سطری (make_secrets آن را می‌سازد)
  [[ -s "$1" ]] && { head -1 "$1" | tr -d '\r\n'; return 0; }
  return 0
}

wait_http() { # <url> <timeout_sec>
  local url="$1" limit="${2:-60}" i=0
  (( limit == 0 )) && limit=1
  while (( i < limit )); do
    curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

# ─── ۱) بررسیِ پیش‌نیازها ─────────────────────────────────────────────────────
check_all() {
  local bad=0
  step "بررسیِ پیش‌نیازها"
  need_cmd git  && ok "git $(git --version | awk '{print $3}')" || { warn "git نیست"; bad=1; }
  need_cmd curl && ok "curl موجود است" || { warn "curl نیست (برایِ بررسیِ سلامت لازم است)"; bad=1; }
  if need_cmd node; then
    if node_is_old; then warn "Node قدیمی است: $(node_v) — حداقل ۲۰.۱۱ (پیشنهاد: ۲۴ LTS)"; bad=1
    else ok "Node $(node_v)"; fi
  else warn "Node نصب نیست (حداقل ۲۰.۱۱)"; bad=1; fi
  need_cmd npm && ok "npm $(npm -v)" || { warn "npm نصب نیست"; bad=1; }

  build_pg_candidates
  if [[ ${#PGBINS[@]} -gt 0 ]]; then
    # داخلِ ‎$( … )‎ِ نقل‌قول‌شده، ‎${arr[0]}‎ به‌صورتِ متن پارس می‌شود (خطایِ
    # «…/bin[0]/postgres: No such file»)؛ پس پیش ازِ آن یک متغیر می‌گیریم.
    local pb; pb="${PGBINS[0]}"
    ok "PostgreSQL — نسخه $("$pb/postgres" --version 2>/dev/null | awk '{print $NF}' | cut -d. -f1)  ($pb)"
  else
    warn "PostgreSQL پیدا نشد — «bash $SELF install» آن را نصب می‌کند"
  fi
  if [[ -d "$ROOT/node_modules/next" ]]; then
    ok "وابستگی‌هایِ npm نصب است (next $(node -e 'process.stdout.write(require("next/package.json").version)' 2>/dev/null))"
  else
    warn "وابستگی‌ها نصب نشده است — «npm ci» لازم است (خودکار انجام می‌شود)"
  fi
  if [[ ${#PGBINS[@]} -eq 0 ]] || ! need_cmd node || node_is_old; then bad=1; fi
  if (( bad )); then warn "همه‌چیز آماده نیست؛ ادامه بده:  bash $SELF install"; else ok "پیش‌نیازها کامل است"; fi
  return "$bad"
}

# ─── ۲) نصبِ پیش‌نیازهایِ سامانه ──────────────────────────────────────────────
install_prereqs() {
  step "پیش‌نیازهایِ سامانه"
  build_pg_candidates
  if [[ ${#PGBINS[@]} -gt 0 ]]; then
    ok "PostgreSQL موجود است: ${PGBINS[0]} — نیازی به نصب نیست"
    return 0
  fi
  case "$(uname -s)" in
    Darwin)
      need_cmd brew || die "برایِ نصبِ PostgreSQL به Homebrew نیاز است: https://brew.sh — و سپس دوباره: bash $SELF install"
      say "نصبِ PostgreSQL با brew (postgresql@17)…"
      brew install postgresql@17 || brew install postgresql || die "brew install ناموفق بود"
      brew link --overwrite --force postgresql@17 >/dev/null 2>&1 || true
      ;;
    Linux)
      [[ -n "$SUDO" ]] && say "برایِ نصبِ بسته از «$SUDO» استفاده می‌شود."
      if need_cmd apt-get; then
        $SUDO apt-get update -qq || true
        $SUDO apt-get install -y -qq postgresql postgresql-contrib || die "apt-get install ناموفق بود"
      elif need_cmd dnf; then
        $SUDO dnf install -y postgresql-server postgresql-contrib || die "dnf install ناموفق بود"
      elif need_cmd yum; then
        $SUDO yum install -y postgresql-server postgresql-contrib || die "yum install ناموفق بود"
      elif need_cmd pacman; then
        $SUDO pacman -S --noconfirm --needed postgresql || die "pacman install ناموفق بود"
      elif need_cmd zypper; then
        $SUDO zypper --non-interactive install postgresql-server || die "zypper install ناموفق بود"
      else
        die "بسته‌بندِ شناخته‌شده‌ای نبود. PostgreSQL را خودت نصب کن، یا پستگرسِ خودت را بده:  bash $SELF --db-url=postgres://…"
      fi
      ;;
    *) die "این سامانه پشتیبانی نمی‌شود؛ PostgreSQL را خودت نصب کن و با --db-url بده." ;;
  esac
  build_pg_candidates
  [[ ${#PGBINS[@]} -gt 0 ]] || die "پس ازِ نصب هم initdb پیدا نشد. اگر نصب است، مسیرش را بده:  PGBIN=/مسیر/bin bash $SELF run"
  ok "PostgreSQL آماده است: ${PGBINS[0]}"
}

install_node_deps() {
  step "وابستگی‌هایِ پروژه"
  cd "$ROOT" || die "نمی‌توان وارد $ROOT شد"
  if [[ -d node_modules/next ]]; then ok "وابستگی‌ها از پیش نصب است"; return 0; fi
  if [[ -f package-lock.json ]]; then
    say "npm ci … (یک‌بار، بسته به اینترنت چند دقیقه)"
    npm ci --no-audit --no-fund || { warn "npm ci نشد؛ npm install امتحان می‌شود"; npm install --no-audit --no-fund || die "npm install ناموفق بود"; }
  else
    npm install --no-audit --no-fund || die "npm install ناموفق بود"
  fi
  ok "وابستگی‌ها نصب شد"
}

# ─── ۳) رازهایِ محلی ──────────────────────────────────────────────────────────
make_secrets() {
  step "کلیدهایِ محلی (بیرون از مخزن)"
  mkdir -p "$STATE_DIR" "$LOG_DIR" "$PID_DIR"
  chmod 700 "$STATE_DIR" 2>/dev/null || true
  local v
  for v in TOKEN_FILE MASTER_FILE; do
    local f="${!v}" label="؟"
    [[ "$v" == "TOKEN_FILE" ]] && label="کلیدِ تماسِ درونی (وب → API)"
    [[ "$v" == "MASTER_FILE" ]] && label="کلیدِ گاوصندوقِ گواهیِ مؤدیان"
    if [[ ! -s "$f" ]]; then
      if need_cmd openssl; then openssl rand -base64 32 > "$f"; else head -c 32 /dev/urandom | base64 | tr -d '\n' > "$f"; fi
      chmod 600 "$f"
      say "  ساخته شد: $label → $f"
    else
      say "  از پیش موجود: $label"
    fi
  done
}

# ─── ۴) پایگاه‌داده، مهاجرت، نشاندن ──────────────────────────────────────────
count_products() {
  local p; p="$(pgtool psql)"; [[ -n "$p" ]] || return 1
  "$p" "$DB_URL" -tAc 'SELECT COUNT(*) FROM products' 2>/dev/null || return 1
}

ensure_db() {
  step "پایگاه‌داده"
  build_pg_candidates
  if [[ -n "${DB_URL:-}" ]]; then
    say "از پستگرسِ داده‌شده استفاده می‌شود: $DB_URL"
    DB_MODE="external"; export DB_URL
  else
    local b; b="$(pgbin)"; [[ -n "$b" ]] || die "initdb پیدا نشد — «bash $SELF install» را اجرا کن یا --db-url بده."
    export PGBIN="$b"
    if [[ "$RESET_DB" == "1" ]]; then
      if confirm "همه‌یِ داده‌یِ توسعه در $PGDATA پاک و از نو ساخته شود؟"; then
        [[ -f "$PGDATA/PG_VERSION" ]] && "$b/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
        rm -rf "$PGDATA"; say "خوشه‌یِ توسعه پاک شد؛ از نو ساخته می‌شود."
      else
        warn "انصراف؛ خوشه دست‌نخورده ماند."
      fi
    fi
    # سازگاریِ نسخه: خوشه‌ای که با پستگرسِ دیگری ساخته شده، با پیامِ گمراه‌کننده
    # بالا نمی‌آید؛ پیش ازِ تلاش، خودمان می‌گوییم مشکل چیست.
    if [[ -f "$PGDATA/PG_VERSION" && -x "$b/postgres" ]]; then
      local want have
      want="$("$b/postgres" --version 2>/dev/null | awk '{print $NF}' | cut -d. -f1)"
      have="$(cut -d. -f1 < "$PGDATA/PG_VERSION")"
      [[ -n "$want" && -n "$have" && "$want" != "$have" ]] && \
        die "خوشهٔ $PGDATA برایِ PostgreSQL $have ساخته شده ولی برنامهٔ پیدا‌شده $want است. یا نسخه را یکی کن، یا --reset-db بزن (دادهٔ توسعه می‌رود)."
    fi
    PGDATA="$PGDATA" PGRUN="$PGRUN" PGPORT="$PGPORT" PGUSER="$PGUSER" PGDB="$PGDB" \
      bash "$ROOT/scripts/pg-start.sh" | tail -4
    export DB_URL="postgres://${PGUSER}@/${PGDB}?host=${PGRUN}&port=${PGPORT}"
  fi
  # مختصاتِ پایگاه را نگه می‌داریم: اگر «status» یا «stop» را بی‌گزینه اجرا کنی،
  # اسکریپت باید بداند خوشه‌ات کجاست (مثلاً وقتی با --db-url یا SETSHOP_PGPORT
  # چیزِ دیگری داده‌ای). بدونِ این پرونده، stopِ پایگاه بی‌صدا هیچ نمی‌کرد.
  if [[ -d "$STATE_DIR" ]]; then
    # DB_MODE «private» یعنی خوشه‌ای که خودِ همین اسکریپت ساخته (زیرِ
    # ~/.setshop) و «external» یعنی پستگرسِ خودِ کاربر (--db-url). تفکیک
    # لازم است: در حالتِ private، «run» نباید مقادیرِ ثبت‌شده را بخواند —
    # اگر روزی پورت را عوض کرده باشی، خواندنِ عددِ کهنه یعنی ساختنِ خوشهٔ
    # تازه رویِ خوشهٔ دیگری. فقط stop/status/logs حقِ خواندن دارند.
    { printf 'PGPORT=%s\nPGDATA=%s\nPGRUN=%s\nPGUSER=%s\nPGDB=%s\n' \
        "$PGPORT" "$PGDATA" "$PGRUN" "$PGUSER" "$PGDB"
      printf 'DB_URL=%s\nDB_MODE=%s\n' "$DB_URL" "$([[ -n "${DB_URL:-}" && "${DB_MODE:-private}" == "external" ]] && echo external || echo private)"
    } > "$STATE_DIR/state.env"
    chmod 600 "$STATE_DIR/state.env" 2>/dev/null || true
  fi
  export TSX_TSCONFIG_PATH=./tsconfig.json

  step "مهاجرت‌ها"
  ( cd "$ROOT" && npm run migrate --silent 2>&1 | tail -2 )

  # نشاندنِ کاتالوگ فقط وقتی پایگاه خالی است؛ فروشگاهِ واقعی کالاهایِ خودش را
  # دارد و نشاندنِ همیشگی یعنی بازنویسیِ آنچه مدیر در پنل ساخته است.
  local n; n="$(count_products || echo '')"
  if [[ "${n//[^0-9]/}" == "0" ]]; then
    step "نشاندنِ کاتالوگِ نمونه و کاربران"
    ( cd "$ROOT" && ./node_modules/.bin/tsx scripts/seed-catalog.ts 2>&1 | tail -5 )
    ( cd "$ROOT" && ./node_modules/.bin/tsx scripts/create-admin.ts 2>&1 | tail -8 )
  else
    say "کاتالوگ از پیش وجود دارد${n:+ (${n} کالا)} — نشاندنِ دوباره انجام نمی‌شود."
  fi
}

seed_sales() {
  # «فروشِ نمونه» از خودِ OrderService می‌گذرد (نه درجِ مستقیم در جدول) و پیش ازِ
  # نشاندن، نمونه‌هایِ پیشین را پاک می‌کند؛ پس اجرایِ دوباره داده را دوبرابر
  # نمی‌کند. بی‌آن، صفحه‌هایِ گزارشِ مدیر خالی است.
  step "نشاندنِ فروشِ نمونه (برایِ گزارش‌ها)"
  ( cd "$ROOT" && ./node_modules/.bin/tsx scripts/seed-orders.ts 2>&1 | tail -4 )
  ( cd "$ROOT" && ./node_modules/.bin/tsx scripts/seed-demo-sales.ts 2>&1 | tail -4 )
}

# ─── ۵) سرویس‌ها ──────────────────────────────────────────────────────────────
start_api() {
  step "API"
  if alive api; then ok "API از پیش در حالِ اجراست (pid $(cat "$PID_DIR/api.pid"))"; return 0; fi
  port_free "$API_PORT" || die "پورت $API_PORT اشغال است — با --api-port پورتِ دیگری بده."
  mkdir -p "$LOG_DIR" "$PID_DIR"
  local log="$LOG_DIR/api.log"
  nohup env \
    NODE_ENV="${NODE_ENV:-development}" \
    DB_URL="$DB_URL" \
    APP_URL="http://127.0.0.1:${WEB_PORT}" \
    API_HOST="${API_HOST:-0.0.0.0}" PORT="$API_PORT" \
    INTERNAL_API_TOKEN="$(_read_key "$TOKEN_FILE")" \
    SET_MASTER_KEY="$(_read_key "$MASTER_FILE")" \
    VAT_RATE_BP="${VAT_RATE_BP:-900}" \
    PAYMENT_GATEWAY="${PAYMENT_GATEWAY:-sandbox}" \
    NODE_OPTIONS=--max-old-space-size=768 \
    TSX_TSCONFIG_PATH=./tsconfig.json \
    "$ROOT/node_modules/.bin/tsx" "$ROOT/apps/api/src/main.ts" >"$log" 2>&1 &
  echo $! > "$PID_DIR/api.pid"
  if wait_http "http://127.0.0.1:${API_PORT}/health" 90; then
    ok "API بالا آمد: http://127.0.0.1:${API_PORT}  (برداشتِ سلامت: /health/ready)"
  else
    tail -12 "$log" 2>/dev/null || true
    die "API بالا نیامد (لاگ: $log)"
  fi
}

start_web() {
  step "وب"
  if alive web; then ok "وب از پیش در حالِ اجراست (pid $(cat "$PID_DIR/web.pid"))"; return 0; fi
  port_free "$WEB_PORT" || die "پورت $WEB_PORT اشغال است — با --web-port پورتِ دیگری بده."
  mkdir -p "$LOG_DIR" "$PID_DIR"
  local log="$LOG_DIR/web.log"
  local sub="dev"
  if [[ "$MODE" == "prod" ]]; then
    sub="start"
    # چرا build در همین‌جا و نه رویِ سرورِ جدا؟ چون صفحه‌هایِ ویترینی در زمانِ
    # ساخت از API داده می‌گیرند (generateStaticParams)؛ اگر ساخت رویِ ماشینِ
    # بی‌دسترسی به پایگاه انجام شود، کشِ صفحه‌ها بی‌صدا از دست می‌رود.
    # «next dev» هم پوشهٔ .next را می‌سازد و BUILD_ID هم می‌گذارد، ولی خروجی‌اش
    # برایِ «next start» قابلِ اجرا نیست. اگر ردِ dev آنجا باشد، می‌گوییم و
    # می‌سازیم — نه اینکه با خطایِ مبهمِ «Cannot find module」 رهایت کند.
    # .env.local در نکست در زمانِ ساخت «پُخت» می‌شود؛ اگر چنین پرونده‌ای هست،
    # ساختِ کهنه ممکن است هنوز API_BASE قدیمی را حمل کند. می‌گوییم، تصمیم با توست.
    if ls "$ROOT/apps/web/.env" "$ROOT/apps/web/.env.local" >/dev/null 2>&1; then
      warn "برایِ وب .env دارید؛ اگر نشانی/توکن عوض شده، پیش ازِ اجرا بسازید:  rm -rf apps/web/.next && bash $SELF --prod"
    fi
    if [[ -f "$ROOT/apps/web/.next/BUILD_ID" && ! -f "$ROOT/apps/web/.next/required-server-files.json" ]]; then
      warn "ساختِ موجود از «next dev» است؛ برایِ production از نو ساخته می‌شود."
      rm -rf "$ROOT/apps/web/.next"
      NEED_BUILD=1
    elif [[ -f "$ROOT/apps/web/.next/BUILD_ID" ]]; then
      say "ساختِ وب از پیش هست؛ دوباره ساخته نمی‌شود (برایِ ساختِ تازه: rm -rf apps/web/.next)"
    else
      NEED_BUILD=1
    fi
    if [[ "${NEED_BUILD:-0}" == "1" ]]; then
      say "ساختِ وب (next build) — یک‌بار چند دقیقه طول می‌کشد…"
      ( cd "$ROOT/apps/web" && INTERNAL_API_TOKEN="$(_read_key "$TOKEN_FILE")" API_BASE="$API_BASE" \
          "$ROOT/node_modules/.bin/next" build ) 2>&1 | tail -25
      [[ -f "$ROOT/apps/web/.next/BUILD_ID" ]] || die "ساختِ وب موفق نشد (بالا را ببین، یا لاگ را با: bash $SELF logs web)"
    fi
  fi
  ( cd "$ROOT/apps/web" && exec env INTERNAL_API_TOKEN="$(_read_key "$TOKEN_FILE")" API_BASE="$API_BASE" \
      "$ROOT/node_modules/.bin/next" "$sub" -H 0.0.0.0 -p "$WEB_PORT" ) >"$log" 2>&1 &
  echo $! > "$PID_DIR/web.pid"
  if wait_http "http://127.0.0.1:${WEB_PORT}/" 240; then
    ok "وب بالا آمد: http://localhost:${WEB_PORT}"
  else
    tail -12 "$log" 2>/dev/null || true
    die "وب پاسخ نداد (لاگ: $log)"
  fi
}

summary() {
  step "آماده است"
  cat <<EOF
  فروشگاه (ویترینِ مشتری):      http://localhost:${WEB_PORT}
  پنلِ مدیریت:                  http://localhost:${WEB_PORT}/admin
  API (فقط برایِ مصرفِ داخلی):   http://127.0.0.1:${API_PORT}

  نخستین ورودِ مدیر:  ۰۹۱۲۰۰۰۰۰۰  /  SetShop@1404     ← بی‌درنگ از پنل عوضش کن
  بقیهٔ کاربرانِ نمونه: ۰۹۱۲۰۰۰۰۰۰۱ فروشنده · ۰۹۱۲۰۰۰۰۰۰۲ انباردار · ۰۹۱۲۰۰۰۰۰۰۳ حسابدار

  فرمان‌هایِ روزمره:
    bash $SELF status          وضعیتِ سرویس‌ها
    bash $SELF logs web -f     پی‌گیریِ لاگِ وب (api و db هم همین‌طور)
    bash $SELF stop            خاموش کردنِ همه‌چیز
    bash $SELF --prod          اجرایِ بهینه‌سازی‌شده (بعد ازِ هر تغییرِ بزرگِ کد)

  حالتِ اجرا: $MODE · لاگ‌ها: $LOG_DIR · کلیدها: $STATE_DIR (هیچ‌کدام به مخزن نمی‌روند)
EOF
  if [[ "$OPEN" == "1" ]]; then
    if need_cmd open; then open "http://localhost:${WEB_PORT}/" >/dev/null 2>&1 || true
    elif need_cmd xdg-open; then xdg-open "http://localhost:${WEB_PORT}/" >/dev/null 2>&1 &
    else warn "مرورگر خودکار باز نشد؛ نشانیِ بالا را دستی باز کن."; fi
  fi
}

show_status() {
  step "وضعیتِ سرویس‌ها"
  local s n
  # وضعیت از دو جا خوانده می‌شود: pidfileهایِ خودِ اسکریپت، و پورت‌ها. اگر
  # سرویسی را دستی (npm run start:api) بالا آورده باشی، اینجا هم دیده می‌شود —
  # وگرنه «خاموش» نشان می‌داد در حالی که سرویس بالا بود.
  local pid
  for s in api web; do
    pid=""
    [[ "$s" == "api" ]] && pid="$(port_pid "$API_PORT")"
    [[ "$s" == "web" ]] && pid="$(port_pid "$WEB_PORT")"
    if alive "$s"; then printf '  %s%-4s%s %sدر حالِ اجرا%s (pid %s، پورت %s)\n' "$C_B" "$s" "$C_0" "$C_OK" "$C_0" "$(cat "$PID_DIR/$s.pid")" "$([[ "$s" == "api" ]] && echo "$API_PORT" || echo "$WEB_PORT")"
    elif [[ -n "$pid" ]]; then printf '  %s%-4s%s %sدر حالِ اجرا (خارج ازِ این اسکریپت)%s (pid %s، پورت %s)\n' "$C_B" "$s" "$C_0" "$C_OK" "$C_0" "$pid" "$([[ "$s" == "api" ]] && echo "$API_PORT" || echo "$WEB_PORT")"
    else printf '  %s%-4s%s %sخاموش%s\n' "$C_B" "$s" "$C_0" "$C_WARN" "$C_0"; fi
  done
  build_pg_candidates
  local b r
  b="$(pgtool pg_isready)"
  if [[ -n "$b" ]] && "$b" -q -h "$PGRUN" -p "$PGPORT" 2>/dev/null; then r="ok"; else r="-"; fi
  if [[ "$r" == "ok" ]]; then printf '  %s%-4s%s %sدر حالِ اجرا%s (سوکت %s، پورت %s)\n' "$C_B" "db" "$C_0" "$C_OK" "$C_0" "$PGRUN" "$PGPORT"
  else printf '  %s%-4s%s %sخاموش%s\n' "$C_B" "db" "$C_0" "$C_WARN" "$C_0"; fi
  n="$(curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT}/health" 2>/dev/null | head -c 60)"
  printf '  API /health:   %s\n' "${n:-—}"
  printf '  وب /:           %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${WEB_PORT}/" 2>/dev/null || echo '—')"
}

show_logs() {
  local f
  case "$LOG_TARGET" in
    api) f="$LOG_DIR/api.log" ;;
    web) f="$LOG_DIR/web.log" ;;
    db|pg) f="$PGDATA/server.log" ;;
    all) f="$LOG_DIR/api.log $LOG_DIR/web.log" ;;
    *) die "برایِ لاگ یکی را بده: api | web | db | all" ;;
  esac
  [[ -e $f ]] || die "لاگی نیست ($f) — اول «bash $SELF run» را اجرا کن."
  if [[ "$LOG_FOLLOW" == "1" ]]; then tail -n 50 -f $f; else tail -n 50 $f; fi
}

# ─── اصلی ─────────────────────────────────────────────────────────────────────
[[ -f "$ROOT/package.json" ]] || die "package.json در $ROOT نیست؛ این اسکریپت باید داخلِ پوشهٔ مخزنِ ست‌شاپ باشد (git clone و سپس bash setup.sh)."
if [[ -n "$EXTRA_ENV" ]]; then
  [[ -f "$EXTRA_ENV" ]] || die "پروندهٔ محیط «$EXTRA_ENV» پیدا نشد"
  set -a; . "$EXTRA_ENV"; set +a
  say "متغیرهایِ محیطی از $EXTRA_ENV خوانده شد"
fi

# مختصاتِ پایگاه از ~/.setshop/state.env خوانده می‌شود (همان چیزی که «run» نوشته).
# چرا؟ چون اگر یک‌بار با SETSHOP_PGPORT=5444 پایگاه را ساخته باشی و بارِ بعد
# «stop» را بی‌گزینه بزنی، اسکریپت سراغِ پورتِ پیش‌فرض (۵۴۳۳) می‌رود و — بدترین
# حالت — خوشهٔ دیگری را که روی آن پورت است خاموش می‌کند. این خواندن فقط برایِ
# فرمان‌هایِ «بدونِ ساخت‌وساز» است (status/stop/logs/db): در «run» عددِ کهنه
# می‌تواند خوشهٔ تازه را رویِ خوشهٔ دیگری بسازد، پس آن‌جا دست‌نخورده می‌ماند.
if [[ "$CMD" != "run" && "$CMD" != "install" && "$CMD" != "check" && -f "$STATE_DIR/state.env" ]]; then   # status | stop | logs | db
  state_pgport="$(sed -nE 's/^PGPORT=//p' "$STATE_DIR/state.env" | head -1)"
  state_pgdata="$(sed -nE 's/^PGDATA=//p' "$STATE_DIR/state.env" | head -1)"
  state_pgrun="$(sed -nE 's/^PGRUN=//p' "$STATE_DIR/state.env" | head -1)"
  state_pguser="$(sed -nE 's/^PGUSER=//p' "$STATE_DIR/state.env" | head -1)"
  state_pgdb="$(sed -nE 's/^PGDB=//p' "$STATE_DIR/state.env" | head -1)"
  state_dburl="$(sed -nE 's/^DB_URL=//p' "$STATE_DIR/state.env" | head -1)"
  [[ -z "${SETSHOP_PGPORT:-}" && -n "$state_pgport" ]] && PGPORT="$state_pgport"
  [[ -z "${SETSHOP_PGDATA:-}" && -n "$state_pgdata" ]] && PGDATA="$state_pgdata"
  [[ -z "${SETSHOP_PGRUN:-}"  && -n "$state_pgrun"  ]] && PGRUN="$state_pgrun"
  [[ -z "${SETSHOP_PGUSER:-}" && -n "$state_pguser" ]] && PGUSER="$state_pguser"
  [[ -z "${SETSHOP_PGDB:-}"   && -n "$state_pgdb"   ]] && PGDB="$state_pgdb"
  # --db-url از خطِ فرمان مقدم است؛ اگر نبود، همان DSNِ ثبت‌شده به کار می‌رود
  [[ -z "${DB_URL:-}" && -n "$state_dburl" ]] && DB_URL="$state_dburl"
  export PGPORT PGDATA PGRUN PGUSER PGDB
fi

case "$CMD" in
  help) usage ;;
  check) check_all; exit $? ;;
  install) install_prereqs; install_node_deps; make_secrets; ok "نصب تمام شد — حالا:  bash $SELF" ;;
  db) make_secrets; ensure_db; ok "پایگاه آماده است." ;;
  status) show_status ;;
  stop)
    step "خاموش کردن"
    stop_service web; stop_service api
    if [[ "$STOP_DB" == "1" ]]; then
      build_pg_candidates
      local_b="$(pgbin)"
      if [[ -n "$local_b" && -f "$PGDATA/PG_VERSION" ]]; then
        "$local_b/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
        ok "پایگاه خاموش شد"
      fi
    else
      ok "پایگاه روشن ماند (--keep-db)"
    fi
    ;;
  logs) show_logs ;;
  seed) ensure_db; seed_sales; ok "فروشِ نمونه آماده است." ;;
  run)
    say "${C_B}ست‌شاپ${C_0} — حالتِ اجرا: $MODE"
    # دو پیامِ روشن، پیش ازِ هر کاری: نبودِ Node نباید با «command not found» در
    # میانهٔ نصب معلوم شود، و نبودِ git روی مک با ابزارکِ خودِ مک حل می‌شود —
    # گفتنش ارزان‌تر از بیست دقیقه جست‌جوست.
    if ! need_cmd node; then
      die "Node نصب نیست. حداقلِ لازم ۲۰.۱۱ (پیشنهاد: ۲۴ LTS).
     با Homebrew:  brew install node
     با nvm:        nvm install 24 && nvm use 24
     سپس دوباره:   bash $SELF"
    fi
    if node_is_old; then
      die "Node $(node_v) قدیمی است — ۲۰.۱۱+ لازم است.
     nvm install 24 && nvm use 24        (یا: brew upgrade node)
     سپس دوباره:   bash $SELF"
    fi
    if ! need_cmd git; then
      die "git نصب نیست. روی مک کافی است:  xcode-select --install   و سپس: bash $SELF"
    fi
    install_prereqs
    install_node_deps
    make_secrets          # پیش ازِ پایگاه: سرویس‌ها و کلیدها هم‌جایِ هم ساخته شوند
    ensure_db
    start_api
    start_web
    [[ "$WITH_SALES" == "1" ]] && seed_sales
    summary
    ;;
  *) die "فرمانِ ناشناخته: $CMD" ;;
esac
