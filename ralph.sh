#!/bin/bash
#
# RALPH - Recursive Autonomous Loop for Project Handling for JetLag: The Game
#
# Runs Claude Code in autonomous mode, executing one iteration at a time for JetLag development.
# Uses RALPH.md as the guide and TASKS.md as the progress tracker.
#
# Usage:
#   ./ralph_jetlag.sh              # Run full loop
#   ./ralph_jetlag.sh --once       # Run single iteration
#   ./ralph_jetlag.sh --dry-run    # Show what would be executed
#   ./ralph_jetlag.sh --verbose    # Stream output live

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPH_PROMPT="$SCRIPT_DIR/RALPH.md"

# Configuration
MAX_ITERATIONS=20
ITERATION_DELAY=5
LOG_DIR="$SCRIPT_DIR/logs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Flags
SINGLE_RUN=false
DRY_RUN=false
VERBOSE=false
STOP_REQUESTED=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --once)
            SINGLE_RUN=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--once] [--dry-run] [--verbose] [-h|--help]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

mkdir -p "$LOG_DIR"

# Patterns to detect secrets
SECRET_PATTERNS=(
    'api[_-]?key\s*[:=]'
    'api[_-]?secret\s*[:=]'
    'access[_-]?token\s*[:=]'
    'secret[_-]?key\s*[:=]'
    'private[_-]?key\s*[:=]'
    'password\s*[:=]'
    'auth[_-]?token\s*[:=]'
    'bearer\s+'
    'AKIA[0-9A-Z]{16}'
    'ghp_[0-9a-zA-Z]{36}'
)

log()     { echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"; }
success() { echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] ✓${NC} $1"; }
warn()    { echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] ⚠${NC} $1"; }
error()   { echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ✗${NC} $1"; }

scan_for_secrets() {
    log "Scanning staged/tracked files for secrets..."
    local found=0
    for pattern in "${SECRET_PATTERNS[@]}"; do
        local matches
        matches=$(git diff --cached --unified=0 2>/dev/null | grep -iE "$pattern" || true)
        if [[ -n "$matches" ]]; then
            error "Possible secret detected (pattern: $pattern)"
            error "$matches"
            found=1
        fi
    done
    if [[ $found -eq 1 ]]; then
        error "Secrets scan failed. Aborting iteration."
        exit 1
    fi
    success "Secrets scan passed"
}

check_prerequisites() {
    log "Checking prerequisites..."
    if ! command -v claude &> /dev/null; then
        error "claude CLI not found. Install it from https://claude.ai/code"
        exit 1
    fi
    if ! command -v npm &> /dev/null; then
        error "npm not found. Install Node.js"
        exit 1
    fi
    if [[ ! -f "$RALPH_PROMPT" ]]; then
        error "RALPH.md not found at $RALPH_PROMPT"
        exit 1
    fi
    if [[ ! -f "$SCRIPT_DIR/spec/DESIGN.md" ]] || [[ ! -f "$SCRIPT_DIR/spec/TASKS.md" ]]; then
        error "DESIGN.md or TASKS.md missing in spec/"
        exit 1
    fi
    success "Prerequisites ok"
}

run_iteration() {
    local iteration=$1
    local log_file="$LOG_DIR/ralph_${TIMESTAMP}_iter${iteration}.log"
    log "Starting iteration $iteration. Log: $log_file"

    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY RUN] Would execute claude with RALPH.md"
        return 0
    fi

    cd "$SCRIPT_DIR"

    if [[ "$VERBOSE" == "true" ]]; then
        claude --dangerously-skip-permissions -p "$(cat "$RALPH_PROMPT")" 2>&1 | tee "$log_file"
    else
        claude --dangerously-skip-permissions -p "$(cat "$RALPH_PROMPT")" > "$log_file" 2>&1
    fi

    success "Iteration $iteration completed"
}

handle_interrupt() {
    if [[ "$STOP_REQUESTED" == "true" ]]; then
        warn "Force quit"
        exit 130
    fi
    warn "Ctrl+C detected — iteration will finish first"
    STOP_REQUESTED=true
}
trap 'handle_interrupt' INT

main() {
    echo "Starting RALPH autonomous loop for JetLag: The Game"
    check_prerequisites

    if [[ "$SINGLE_RUN" == "true" ]]; then
        scan_for_secrets
        run_iteration 1
        exit 0
    fi

    for ((i=1;i<=MAX_ITERATIONS;i++)); do
        scan_for_secrets
        run_iteration $i
        if [[ $i -lt $MAX_ITERATIONS ]]; then
            log "Waiting $ITERATION_DELAY seconds before next iteration..."
            sleep $ITERATION_DELAY || true
        fi
        if [[ "$STOP_REQUESTED" == "true" ]]; then
            warn "Stop requested — exiting after iteration $i"
            break
        fi
    done

    success "RALPH loop finished"
}

main "$@"
