CREATE OR REPLACE FUNCTION sentient_fill_task_child_correlation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.correlation_id IS NULL OR NEW.correlation_id = '') AND NEW.task_id IS NOT NULL THEN
    SELECT correlation_id INTO NEW.correlation_id FROM tasks WHERE id = NEW.task_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS model_calls_fill_correlation ON model_calls;
CREATE TRIGGER model_calls_fill_correlation
BEFORE INSERT OR UPDATE OF task_id, correlation_id ON model_calls
FOR EACH ROW EXECUTE FUNCTION sentient_fill_task_child_correlation();

DROP TRIGGER IF EXISTS action_runs_fill_correlation ON action_runs;
CREATE TRIGGER action_runs_fill_correlation
BEFORE INSERT OR UPDATE OF task_id, correlation_id ON action_runs
FOR EACH ROW EXECUTE FUNCTION sentient_fill_task_child_correlation();

DROP TRIGGER IF EXISTS progress_outbox_fill_correlation ON progress_outbox;
CREATE TRIGGER progress_outbox_fill_correlation
BEFORE INSERT OR UPDATE OF task_id, correlation_id ON progress_outbox
FOR EACH ROW EXECUTE FUNCTION sentient_fill_task_child_correlation();

DROP TRIGGER IF EXISTS audit_events_fill_correlation ON audit_events;
CREATE TRIGGER audit_events_fill_correlation
BEFORE INSERT OR UPDATE OF task_id, correlation_id ON audit_events
FOR EACH ROW EXECUTE FUNCTION sentient_fill_task_child_correlation();
