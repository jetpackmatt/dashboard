# Active TODO List

Check at start of each session. Keep it simple - details go in docs.

---

## In Progress

(none)

---

## TODO (When Time Permits)

### Nice to Have
- [ ] Storage tab: per-day dates (blocked - API doesn't provide)

---

## Completed (Dec 2025)

- [x] **Transit time backfill** - 100% complete (69,506 shipments updated)
- [x] **Timeline backfill** - 100% complete (72,855 shipments), sync-timelines cron re-enabled
- [x] **Sync health check** - `/api/admin/sync-health` endpoint + Admin "Sync Health" tab
- [x] **WRO sync** - `syncReceivingOrders()` in cron, receiving_orders table populated
- [x] **SFTP/base_cost backfill** - 60,510 transactions updated from extras CSV
- [x] **Drop merchant_client_map** - Redundant with clients.merchant_id
- [x] **Unused tables cleanup** - Tables don't exist (already clean)
- [x] tracking_id backfill - 100%
- [x] invoice_date_jp backfill - 100%
- [x] period_start/period_end fix
- [x] Link historical transactions - 96.6%
- [x] Fix return_id → shipbob_return_id bug
- [x] Fix sync to use LastUpdateStartDate
- [x] Historical invoice backfill
- [x] Dec 1-7 transaction backfill
- [x] Shipment items quantity fix

---

*See [docs/SYNC-FIX-PROJECT.md](docs/SYNC-FIX-PROJECT.md) for detailed progress and history.*
