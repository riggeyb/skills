CREATE OR REPLACE FUNCTION sentient_fill_root_correlation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    NEW.correlation_id := COALESCE(NULLIF(NEW.correlation_id, ''), NEW.origin->>'deliveryId', NEW.delivery_id);
  ELSIF TG_TABLE_NAME = 'jobs' THEN
    NEW.correlation_id := COALESCE(
      NULLIF(NEW.correlation_id, ''),
      NEW.payload->'origin'->>'deliveryId',
      NEW.payload->>'deliveryId',
      NEW.idempotency_key
    );
  END IF;
  IF NEW.correlation_id IS NULL OR NEW.correlation_id = '' THEN
    RAISE EXCEPTION 'correlation_id is required for %', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_fill_correlation ON tasks;
CREATE TRIGGER tasks_fill_correlation
BEFORE INSERT OR UPDATE OF origin, delivery_id, correlation_id
ON tasks
FOR EACH ROW
EXECUTE FUNCTION sentient_fill_root_correlation();

DROP TRIGGER IF EXISTS jobs_fill_correlation ON jobs;
CREATE TRIGGER jobs_fill_correlation
BEFORE INSERT OR UPDATE OF payload, idempotency_key, correlation_id
ON jobs
FOR EACH ROW
EXECUTE FUNCTION sentient_fill_root_correlation();
