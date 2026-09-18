-- Snapshots taken before pressure existed have no seller-people counts, so the
-- columns default to zero and every trend read against them is a fiction. The
-- rows are derived data: dropping them lets the next worker run rebuild honest
-- history instead of comparing today against a default.
DELETE FROM "HeatSnapshot";
