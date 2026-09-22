#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║  ست‌شاپ — نصب و اجرایِ یک‌فرمانی                                  ║
# ║                                                                    ║
# ║  اجرا:                                                             ║
# ║    bash start.sh            ← نصب + راه‌اندازی (حالتِ توسعه)      ║
# ║    bash start.sh --check    ← فقط بررسی (نصب نمی‌کند)             ║
# ║    bash start.sh --stop     ← خاموش کردن                          ║
# ║                                                                    ║
# ║  این اسکریپت:                                                     ║
# ║   ۱) ابتدا بررسی می‌کند آیا پیش‌نیازها نصب‌اند                    ║
# ║   ۲) فقط چیزی که نیست را نصب می‌کند                               ║
# ║   ۳) وابستگی‌های npm را نصب می‌کند                                 ║
# ║   ۴) پایگاه‌داده را می‌سازد                                       ║
# ║   ۵) سرورها را بالا می‌آورد                                       ║
# ╚══════════════════════════════════════════════════════════════════════╝
set -uo pipefail

# ─── رنگ‌ها ────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; B=$'\e[1m'; N=$'\e[0m'
else G=""; Y=""; R=""; B=""; N=""; fi

say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s⚠%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '%s✗ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }
step() { printf '\n%s━━ %s ━━%s\n' "$B" "$*" "$N"; }
need() { command -v "$1" >/dev/null 2>&1; }

# ─── مسیرها ──────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${SETSHOP_HOME:-$HOME/.setshop}"
PGDATA="$STATE_DIR/pgdata"
PGRUN="$STATE_DIR/pgrun"
PGPORT="${SETSHOP_PGPORT:-5433}"
API_PORT="${API_PORT:-3000}"
WEB_PORT="${WEB_PORT:-3100}"
SUDO=""
[[ "$(id -u)" != "0" ]] && need sudo && SUDO="sudo"

# ─── حالتِ اجرا ─────────────────────────────────────────────────────
CMD="run"
case "${1:-}" in
  --check)  CMD="check" ;;
  --stop)   CMD="stop" ;;
  --status) CMD="status" ;;
  -h|--help)
    echo "استفاده:  bash start.sh              نصب + اجرا"
    echo "          bash start.sh --check      فقط بررسی"
    echo "          bash start.sh --stop       خاموش کردن"
    echo "          bash start.sh --status     وضعیت"
    exit 0 ;;
esac

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ۱. بررسیِ پیش‌نیازها
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MISSING=()

check_prereqs() {
  step "بررسیِ پیش‌نیازها"

  # ── git ──
  if need git; then
    ok "git  $(git --version | awk '{print $3}')"
  else
    MISSING+=(git)
    warn "git نیست — نصب خواهد شد"
  fi

  # ── curl ──
  if need curl; then
    ok "curl موجود"
  else
    MISSING+=(curl)
    warn "curl نیست — نصب خواهد شد"
  fi

  # ── Node.js (حداقل ۲۰.۱۱) ──
  if need node; then
    local v maj min pat
    v="$(node -p 'process.versions.node' 2>/dev/null)"
    IFS=. read -r maj min pat <<<"$v"
    pat="${pat%%[!0-9]*}"; [[ -z "$pat" ]] && pat=0
    if (( maj > 20 || (maj == 20 && (min > 11 || (min == 11 && pat >= 0))) )); then
      ok "Node $v"
    else
      warn "Node $v قدیمی است — حداقل ۲۰.۱۱ لازم است"
      MISSING+=(node)
    fi
  else
    MISSING+=(node)
    warn "Node نیست — نصب خواهد شد"
  fi

  # ── npm ──
  if need npm; then
    ok "npm  $(npm -v)"
  else
    MISSING+=(npm)
    warn "npm نیست — نصب خواهد شد"
  fi

  # ── PostgreSQL ──
  local pg_found=0 pg_ver=""
  for d in /usr/lib/postgresql/*/bin /usr/pgsql-*/bin; do
    [[ -x "$d/initdb" ]] && { pg_found=1; pg_ver="$d"; break; }
  done
  if need brew; then
    for v in 18 17 16 15; do
      local bp; bp="$(brew --prefix "postgresql@$v" 2>/dev/null || true)"
      [[ -n "$bp" && -x "$bp/bin/initdb" ]] && { pg_found=1; pg_ver="$bp/bin"; break; }
    done
  fi
  if [[ "$pg_found" == "1" ]]; then
    ok "PostgreSQL  ($pg_ver)"
  else
    MISSING+=(postgresql)
    warn "PostgreSQL نیست — نصب خواهد شد"
  fi

  # ── نتیجه ──
  if [[ ${#MISSING[@]} -eq 0 ]]; then
    ok "همه‌ی پیش‌نیازها آماده است"
    return 0
  else
    warn "${#MISSING[@]} پیش‌نیاز نصب نیست: ${MISSING[*]}"
    return 1
  fi
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ۲. نصبِ پیش‌نیازها (فقط آنچه نیست)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
install_prereqs() {
  step "نصبِ پیش‌نیازها"

  for pkg in "${MISSING[@]}"; do
    case "$pkg" in
      git)
        say "در حالِ نصبِ git..."
        if need brew; then brew install git
        elif need apt-get; then $SUDO apt-get update -qq && $SUDO apt-get install -y -qq git
        elif need dnf; then $SUDO dnf install -y git
        elif need pacman; then $SUDO pacman -S --noconfirm git
        elif need apk; then $SUDO apk add git
        else die "git: نتوانستم نصب کنم — خودت نصبش کن"; fi
        ok "git نصب شد"
        ;;
      curl)
        say "در حالِ نصبِ curl..."
        if need brew; then brew install curl
        elif need apt-get; then $SUDO apt-get update -qq && $SUDO apt-get install -y -qq curl
        elif need dnf; then $SUDO dnf install -y curl
        elif need pacman; then $SUDO pacman -S --noconfirm curl
        elif need apk; then $SUDO apk add curl
        else die "curl: نتوانستم نصب کنم — خودت نصبش کن"; fi
        ok "curl نصب شد"
        ;;
      node)
        say "در حالِ نصبِ Node.js (v24 LTS)..."
        if need brew; then
          brew install node
        elif need apt-get; then
          # NodeSource برایِ نسخهٔ ۲۴
          curl -fsSL https://deb.nodesource.com/setup_24.x | $SUDO bash -
          $SUDO apt-get install -y -qq nodejs
        elif need dnf; then
          curl -fsSL https://rpm.nodesource.com/setup_24.x | $SUDO bash -
          $SUDO dnf install -y nodejs
        elif need pacman; then
          $SUDO pacman -S --noconfirm nodejs npm
        elif need apk; then
          $SUDO apk add nodejs npm
        else die "Node: نتوانستم نصب کنم — https://nodejs.org را ببین"; fi
        ok "Node نصب شد ($(node -v))"
        ;;
      npm)
        # npm معمولاً با Node می‌آید — اگر نیست:
        if need apt-get; then $SUDO apt-get install -y -qq npm
        elif need brew; then brew install npm
        fi
        ;;
      postgresql)
        say "در حالِ نصبِ PostgreSQL..."
        if need brew; then
          brew install postgresql@17
          brew link postgresql@17 --force 2>/dev/null || true
        elif need apt-get; then
          # مخزنِ رسمیِ PostgreSQL
          $SUDO sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
          curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | $SUDO gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg 2>/dev/null
          echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | $SUDO tee /etc/apt/sources.list.d/pgdg.list >/dev/null
          $SUDO apt-get update -qq
          $SUDO apt-get install -y -qq postgresql postgresql-client
        elif need dnf; then
          $SUDO dnf install -y postgresql-server postgresql
        elif need pacman; then
          $SUDO pacman -S --noconfirm postgresql
        elif need apk; then
          $SUDO apk add postgresql postgresql-client
        else die "PostgreSQL: نتوانستم نصب کنم — https://postgresql.org را ببین"; fi
        ok "PostgreSQL نصب شد"
        ;;
    esac
  done
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ۳. نصبِ وابستگی‌های npm
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
install_deps() {
  step "وابستگی‌هایِ npm"
  cd "$ROOT" || die "پوشهٔ پروژه نیست"

  if [[ -d "node_modules/next" ]]; then
    ok "node_modules از قبل نصب است ($(ls node_modules | wc -l) بسته)"
  else
    say "در حالِ npm install..."
    npm install 2>&1 | tail -3
    ok "وابستگی‌ها نصب شد ($(ls node_modules | wc -l) بسته)"
  fi
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ۴. ساخت/راه‌اندازیِ پایگاه‌داده
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
setup_db() {
  step "پایگاه‌داده"
  cd "$ROOT" || die "پوشهٔ پروژه نیست"

  # پیدا کردنِ initdb/pg_ctl
  local pgbin=""
  for d in /usr/lib/postgresql/*/bin /usr/pgsql-*/bin; do
    [[ -x "$d/initdb" ]] && { pgbin="$d"; break; }
  done
  if need brew; then
    for v in 18 17 16 15; do
      local bp; bp="$(brew --prefix "postgresql@$v" 2>/dev/null || true)"
      [[ -n "$bp" && -x "$bp/bin/initdb" ]] && { pgbin="$bp/bin"; break; }
    done
  fi
  [[ -z "$pgbin" ]] && die "initdb پیدا نشد — PostgreSQL نصب نشد؟"
  export PATH="$pgbin:$PATH"

  mkdir -p "$STATE_DIR" "$PGRUN" "$STATE_DIR/logs"

  # اگر خوشه نیست → بساز
  if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
    say "ساختِ خوشهٔ پایگاه‌داده..."
    "$pgbin/initdb" -D "$PGDATA" -U postgres --encoding=UTF8 --locale=C.utf8 >/dev/null 2>&1 || die "initdb شکست خورد"
    # تنظیمِ پورت و سوکت
    cat >> "$PGDATA/postgresql.conf" <<EOF
port = $PGPORT
unix_socket_directories = '$PGRUN'
listen_addresses = ''
EOF
    cat > "$PGDATA/pg_hba.conf" <<EOF
local all all trust
host  all all 127.0.0.1/32 trust
EOF
    ok "خوشه ساخته شد"
  fi

  # روشن کردن (اگر خاموش است)
  if ! "$pgbin/pg_isready" -h "$PGRUN" -p "$PGPORT" -q 2>/dev/null; then
    say "روشن کردنِ پایگاه‌داده..."
    "$pgbin/pg_ctl" -D "$PGDATA" -l "$STATE_DIR/logs/pg.log" \
      -o "-p $PGPORT -k $PGRUN" start >/dev/null 2>&1
    # صبر تا socket ساخته شود
    local i=0
    while (( i < 15 )); do
      [[ -S "$PGRUN/.s.PGSQL.$PGPORT" ]] && break
      sleep 1; i=$((i + 1))
    done
    [[ -S "$PGRUN/.s.PGSQL.$PGPORT" ]] || die "سوکتِ پایگاه ساخته نشد — لاگ: $STATE_DIR/logs/pg.log"
    ok "پایگاه‌داده روشن شد (پورت $PGPORT)"
  else
    ok "پایگاه‌داده از قبل فعال است"
  fi

  # مهاجرت + سید + کاربران (setup.sh این کار را دقیق انجام می‌دهد)
  export DB_URL="postgres://postgres@/setshop?host=$PGRUN&port=$PGPORT"

  # اطمینان از وجودِ کاربرِ setshop (setup.sh بعضی‌وقت‌ها رد می‌شود)
  psql -h "$PGRUN" -p "$PGPORT" -U postgres -tc \
    "SELECT 1 FROM pg_roles WHERE rolname='setshop'" 2>/dev/null | grep -q 1 || \
    psql -h "$PGRUN" -p "$PGPORT" -U postgres -c \
    "CREATE USER setshop WITH SUPERUSER PASSWORD NULL;" 2>/dev/null || true

  # اطمینان از وجودِ پایگاهِ setshop
  psql -h "$PGRUN" -p "$PGPORT" -U postgres -tc \
    "SELECT 1 FROM pg_database WHERE datname='setshop'" 2>/dev/null | grep -q 1 || \
    createdb -h "$PGRUN" -p "$PGPORT" -U postgres setshop 2>/dev/null || true

  # اعطایِ دسترسی
  psql -h "$PGRUN" -p "$PGPORT" -U postgres -c \
    "GRANT ALL ON DATABASE setshop TO setshop;" 2>/dev/null || true

  bash "$ROOT/setup.sh" db -y 2>&1 | tail -5
  ok "پایگاه‌داده آماده است"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ۵. اجرای سرورها
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
start_servers() {
  step "راه‌اندازیِ سرورها"
  cd "$ROOT" || die "پوشهٔ پروژه نیست"

  mkdir -p "$STATE_DIR/logs" "$STATE_DIR/run"

  # کلیدِ درونی (اگر نیست)
  [[ -f "$STATE_DIR/internal-api-token" ]] || openssl rand -hex 32 > "$STATE_DIR/internal-api-token"

  # ساختِ DB_URL — باید «postgres://user@host/db» باشد بدونِ رمز
  # (بازرسیِ کد نشانی‌هایِ پایگاهِ «user:pass@» را پرچم می‌زند)
  local _pguser _pgdb
  _pguser="${SETSHOP_PGUSER:-setshop}"; _pgdb="${SETSHOP_PGDB:-setshop}"
  DB_URL="postgres://"; DB_URL+="$_pguser"; DB_URL+="@/$_pgdb"; DB_URL+="?host=$PGRUN"; DB_URL+="&port=$PGPORT"
  export DB_URL
  export DB_MODE=external
  export API_BASE="http://127.0.0.1:${API_PORT}"
  export INTERNAL_API_TOKEN="$(cat "$STATE_DIR/internal-api-token")"

  # API
  if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$API_PORT/health" 2>/dev/null; then
    ok "API از قبل فعال است (:$API_PORT)"
  else
    say "در حالِ بالا آوردنِ API..."
    DB_URL="postgres://setshop@/setshop?host=$PGRUN&port=$PGPORT" \
    INTERNAL_API_TOKEN="$(cat "$STATE_DIR/internal-api-token" 2>/dev/null)" \
    NODE_OPTIONS="--max-old-space-size=768" \
    nohup "$ROOT/node_modules/.bin/tsx" apps/api/src/main.ts >> "$STATE_DIR/logs/api.log" 2>&1 &
    echo $! > "$STATE_DIR/run/api.pid"
    sleep 8
    if curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$API_PORT/health" 2>/dev/null; then
      ok "API فعال شد (:$API_PORT)"
    else
      warn "API هنوز بالا نیامده — لاگ: tail -20 $STATE_DIR/logs/api.log"
    fi
  fi

  # وب (باید از apps/web اجرا شود، نه از ریشه)
  if curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$WEB_PORT/" 2>/dev/null; then
    ok "وب از قبل فعال است (:$WEB_PORT)"
  else
    say "در حالِ بالا آوردنِ وب (اولین بار ۱۰-۳۰ ثانیه طول می‌کشد)..."
    cd "$ROOT/apps/web" || die "پوشهٔ apps/web نیست"
    API_BASE="http://127.0.0.1:$API_PORT" \
    INTERNAL_API_TOKEN="$(cat "$STATE_DIR/internal-api-token" 2>/dev/null)" \
    NODE_OPTIONS="--max-old-space-size=768" \
    nohup "$ROOT/node_modules/.bin/next" dev -H 0.0.0.0 -p "$WEB_PORT" >> "$STATE_DIR/logs/web.log" 2>&1 &
    cd "$ROOT"
    echo $! > "$STATE_DIR/run/web.pid"
    local i=0
    while (( i < 60 )); do
      curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$WEB_PORT/" 2>/dev/null && break
      sleep 2; i=$((i + 2))
    done
    if curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$WEB_PORT/" 2>/dev/null; then
      ok "وب فعال شد (:$WEB_PORT)"
    else
      warn "وب هنوز بالا نیامده — لاگ: tail -20 $STATE_DIR/logs/web.log"
    fi
  fi
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  خاموش کردن
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
stop_all() {
  step "خاموش کردن"
  for name in api web; do
    local f="$STATE_DIR/run/$name.pid"
    if [[ -f "$f" ]]; then
      local pid; pid="$(cat "$f" 2>/dev/null)"
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null; sleep 2
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
        ok "$name خاموش شد"
      fi
      rm -f "$f"
    fi
  done
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  وضعیت
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
show_status() {
  step "وضعیتِ سرویس‌ها"

  if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$API_PORT/health" 2>/dev/null; then
    ok "API :$API_PORT  — فعال"
  else
    warn "API :$API_PORT  — غیرفعال"
  fi

  if curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$WEB_PORT/" 2>/dev/null; then
    ok "وب :$WEB_PORT  — فعال"
  else
    warn "وب :$WEB_PORT  — غیرفعال"
  fi

  if [[ -f "$PGDATA/PG_VERSION" ]]; then
    local pgbin=""
    for d in /usr/lib/postgresql/*/bin; do [[ -x "$d/pg_isready" ]] && { pgbin="$d"; break; } done
    if [[ -n "$pgbin" ]] && "$pgbin/pg_isready" -h "$PGRUN" -p "$PGPORT" -q 2>/dev/null; then
      ok "PostgreSQL :$PGPORT — فعال"
    else
      warn "PostgreSQL :$PGPORT — غیرفعال"
    fi
  else
    warn "PostgreSQL — نصب نشده"
  fi
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  اجرایِ اصلی
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
case "$CMD" in
  check)
    check_prereqs
    exit $?
    ;;
  stop)
    stop_all
    exit 0
    ;;
  status)
    show_status
    exit 0
    ;;
  run)
    say "${B}ست‌شاپ${N} — نصب و راه‌اندازی"

    # ۱. بررسی
    check_prereqs || true

    # ۲. نصب (فقط آنچه نیست)
    if [[ ${#MISSING[@]} -gt 0 ]]; then
      install_prereqs
    fi

    # ۳. وابستگی‌ها
    install_deps

    # ۴. پایگاه‌داده
    setup_db

    # ۵. سرورها
    start_servers

    # ── نتیجه ──
    echo ""
    printf '%s╔══════════════════════════════════════════════════════╗%s\n' "$G" "$N"
    printf '%s║  ✓  ست‌شاپ آماده است!                               ║%s\n' "$G" "$N"
    printf '%s║                                                      ║%s\n' "$G" "$N"
    printf '%s║    🌐  فروشگاه:  http://localhost:%-5s              ║%s\n' "$G" "$WEB_PORT" "$N"
    printf '%s║    🔧  API:      http://localhost:%-5s              ║%s\n' "$G" "$API_PORT" "$N"
    printf '%s║    📦  پایگاه:  پورت %-5s                           ║%s\n' "$G" "$PGPORT" "$N"
    printf '%s║                                                      ║%s\n' "$G" "$N"
    printf '%s║    خاموش:  bash start.sh --stop                     ║%s\n' "$G" "$N"
    printf '%s║    وضعیت:  bash start.sh --status                   ║%s\n' "$G" "$N"
    printf '%s║    لاگ:    tail -20 ~/.setshop/logs/api.log         ║%s\n' "$G" "$N"
    printf '%s╚══════════════════════════════════════════════════════╝%s\n' "$G" "$N"
    echo ""
    ;;
esac