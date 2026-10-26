#!/bin/sh
set -eu
fail() { printf 'im-overdue: %s\n' "$1" >&2; exit 1; }
PUID=${PUID:-99}
PGID=${PGID:-100}
for value in "$PUID" "$PGID"; do
    case "$value" in ''|*[!0-9]*|0|0*) fail 'PUID and PGID must be positive decimal IDs without leading zeroes.' ;; esac
    [ "${#value}" -le 10 ] && [ "$value" -le 2147483647 ] || fail 'PUID and PGID are outside the supported ID range.'
done
if [ "${1:-}" = '--healthcheck' ]; then
    if [ "$(id -u)" = 0 ]; then exec gosu "$PUID:$PGID" node /app/healthcheck.mjs; fi
    exec node /app/healthcheck.mjs
fi
[ "${IM_OVERDUE_DB:-/data/im-overdue.sqlite}" = '/data/im-overdue.sqlite' ] || fail 'The container database path is fixed at /data/im-overdue.sqlite.'
export IM_OVERDUE_DB=/data/im-overdue.sqlite
umask 077
[ ! -L /data ] && [ -d /data ] || fail '/data must be a real directory.'
# Only the dedicated database files may be present; never recursively change owners.
validate_data() {
    for path in /data/* /data/.[!.]* /data/..?*; do
        if [ ! -e "$path" ] && [ ! -L "$path" ]; then continue; fi
        case "$path" in /data/im-overdue.sqlite|/data/im-overdue.sqlite-wal|/data/im-overdue.sqlite-shm) ;; *) fail '/data contains unexpected content; use a dedicated appdata directory.' ;; esac
        [ ! -L "$path" ] && [ -f "$path" ] || fail 'Database entries must be regular files without symlinks.'
        [ "$(stat -c %h "$path")" = 1 ] || fail 'Database entries must not have hard links.'
    done
}
validate_data
if [ "$(id -u)" = 0 ]; then
    original_owner=$(stat -c %u:%g /data)
    original_mode=$(stat -c %a /data)
    locked=1
    trap 'if [ "$locked" = 1 ]; then chmod "$original_mode" /data || :; chown --no-dereference "$original_owner" /data || :; fi' 0
    trap 'exit 1' HUP INT TERM
    # Exclude the app UID before validating again and touching child paths.
    chown --no-dereference 0:0 /data
    chmod 0700 /data
    validate_data
    for path in /data/im-overdue.sqlite /data/im-overdue.sqlite-wal /data/im-overdue.sqlite-shm; do
        [ -f "$path" ] || continue
        chown --no-dereference "$PUID:$PGID" "$path"
        chmod 0600 "$path"
    done
    # Hand over last: no privileged child-path operations follow this point.
    chown --no-dereference "$PUID:$PGID" /data
    locked=0
    trap - 0 HUP INT TERM
    exec gosu "$PUID:$PGID" "$@"
fi
[ "$(id -u)" = "$PUID" ] && [ "$(id -g)" = "$PGID" ] || fail 'Non-root execution requires PUID/PGID matching the effective user/group.'
[ "$(stat -c %u /data)" = "$PUID" ] && [ "$(stat -c %g /data)" = "$PGID" ] && [ "$(stat -c %a /data)" = 700 ] || fail 'Non-root execution requires /data owned by PUID:PGID with mode 0700.'
[ -w /data ] && [ -x /data ] || fail '/data is not writable.'
for path in /data/im-overdue.sqlite /data/im-overdue.sqlite-wal /data/im-overdue.sqlite-shm; do
    [ -f "$path" ] || continue
    [ "$(stat -c %u "$path")" = "$PUID" ] && [ "$(stat -c %g "$path")" = "$PGID" ] && [ "$(stat -c %a "$path")" = 600 ] && [ -r "$path" ] && [ -w "$path" ] || fail 'Non-root execution requires private, readable/writable database files owned by PUID:PGID (0600).'
done
exec "$@"
