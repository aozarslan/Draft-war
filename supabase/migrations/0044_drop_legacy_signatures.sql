-- =============================================================================
-- 0044 — drop legacy function overloads
--
-- Three old signatures are still in the database from earlier migrations:
--
--   dw_place_bid(uuid, uuid, integer)          — 0031 compatibility shim
--   dw_pass_auction(uuid, uuid)                — 0031 compatibility shim
--   dw_resolve_matchup(uuid,int,jsonb,uuid,uuid,int) — 0034 6-param version
--
-- All application code uses the newer signatures:
--   dw_place_bid(uuid, uuid, integer, text)    — 4-param (p_action_id added)
--   dw_pass_auction(uuid, uuid, text)          — 3-param (p_action_id added)
--   dw_resolve_matchup(uuid,int,jsonb,uuid,uuid,int,uuid) — 7-param (p_ghost added)
--
-- The shims in 0031 forwarded to the newer versions with null::text — safe to
-- remove now that no client code calls the old arities. No trigger or SQL
-- function body references these old signatures.
--
-- Additive drop: IF EXISTS makes each statement a no-op if already removed.
-- =============================================================================

-- 0031 compatibility shim — forwards to dw_place_bid(uuid,uuid,int,text)
drop function if exists dw_place_bid(uuid, uuid, integer);

-- 0031 compatibility shim — forwards to dw_pass_auction(uuid,uuid,text)
drop function if exists dw_pass_auction(uuid, uuid);

-- 0034 original — superseded by the 7-param version in 0035
drop function if exists dw_resolve_matchup(uuid, integer, jsonb, uuid, uuid, integer);
