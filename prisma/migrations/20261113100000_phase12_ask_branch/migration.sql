-- Phase 12: Ask's read-only views carry the branch of each row, so an answer can stay inside a person's reach.
-- (CREATE OR REPLACE may only add columns at the end.)
CREATE OR REPLACE VIEW ai_v_tasks AS
SELECT t.company_id, t.doer_id AS person_id, t.number, t.description AS task,
  d.name AS doer, c.name AS given_by, dep.name AS department, t.status,
  t.planned_at, t.done_at,
  (t.done_at IS NULL AND t.status IN ('OPEN', 'AWAITING_ACCEPTANCE') AND t.planned_at < now()) AS is_late,
  GREATEST(0, CEIL(EXTRACT(EPOCH FROM (COALESCE(t.done_at, now()) - t.planned_at)) / 86400))::int AS days_late,
  t.revision_count AS date_moves, t.created_at,
  '/delegation?task=' || t.id AS link, t.branch_id
FROM tasks t
JOIN users d ON d.id = t.doer_id
JOIN users c ON c.id = t.creator_id
LEFT JOIN departments dep ON dep.id = d.main_department_id
WHERE t.deleted_at IS NULL;

CREATE OR REPLACE VIEW ai_v_checklists AS
SELECT r.company_id, r.doer_id AS person_id, m.name AS checklist, d.name AS doer, dep.name AS department,
  r.status, r.planned_at, r.submitted_at, r.items_done, r.items_total,
  (r.status = 'MISSED') AS is_missed, '/checklists?run=' || r.id AS link, r.branch_id
FROM checklist_runs r
JOIN checklist_masters m ON m.id = r.master_id
JOIN users d ON d.id = r.doer_id
LEFT JOIN departments dep ON dep.id = COALESCE(m.department_id, d.main_department_id)
WHERE m.deleted_at IS NULL;

CREATE OR REPLACE VIEW ai_v_tickets AS
SELECT k.company_id, k.solver_id AS person_id, k.number, k.title, r.name AS raised_by, s.name AS solver,
  dep.name AS department, k.status, k.escalation_level, k.planned_fix_at, k.resolved_at, k.closed_at,
  k.reopen_count, k.created_at, '/tickets?ticket=' || k.id AS link, k.branch_id
FROM tickets k
JOIN users r ON r.id = k.raiser_id
JOIN users s ON s.id = k.solver_id
LEFT JOIN departments dep ON dep.id = k.department_id
WHERE k.deleted_at IS NULL;

CREATE OR REPLACE VIEW ai_v_fms_steps AS
SELECT s.company_id, s.doer_id AS person_id, f.name AS process, rec.number AS record_number,
  rec.title AS record, s.step_name AS step, d.name AS doer, s.status, s.planned_at, s.done_at,
  (s.done_at IS NULL AND s.status = 'OPEN' AND s.planned_at < now()) AS is_late,
  GREATEST(0, CEIL(EXTRACT(EPOCH FROM (COALESCE(s.done_at, now()) - s.planned_at)) / 86400))::int AS days_late,
  '/fms/live?flow=' || f.id || '&record=' || rec.id AS link, rec.branch_id
FROM fms_record_steps s
JOIN fms_records rec ON rec.id = s.record_id
JOIN flows f ON f.id = rec.flow_id
LEFT JOIN users d ON d.id = s.doer_id
WHERE rec.deleted_at IS NULL AND s.status <> 'SKIPPED';

CREATE OR REPLACE VIEW ai_v_fms_records AS
SELECT rec.company_id, rec.started_by_id AS person_id, f.name AS process, rec.number, rec.title,
  rec.status, rec.started_at, rec.closed_at, st.name AS started_by,
  '/fms/live?flow=' || f.id || '&record=' || rec.id AS link, rec.branch_id
FROM fms_records rec
JOIN flows f ON f.id = rec.flow_id
LEFT JOIN users st ON st.id = rec.started_by_id
WHERE rec.deleted_at IS NULL;
