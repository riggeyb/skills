CREATE OR REPLACE FUNCTION sentient_fill_authorization_correlation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  task_text text;
BEGIN
  IF NEW.correlation_id IS NOT NULL AND NEW.correlation_id <> '' THEN
    RETURN NEW;
  END IF;
  task_text := NEW.metadata->>'taskId';
  IF task_text IS NOT NULL AND task_text <> '' THEN
    SELECT correlation_id INTO NEW.correlation_id FROM tasks WHERE id = task_text::uuid;
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS authorization_events_fill_correlation ON authorization_events;
CREATE TRIGGER authorization_events_fill_correlation
BEFORE INSERT OR UPDATE OF metadata, correlation_id ON authorization_events
FOR EACH ROW EXECUTE FUNCTION sentient_fill_authorization_correlation();
