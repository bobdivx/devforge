SELECT deployment_uuid, status, created_at
FROM application_deployment_queues
WHERE application_id IN ('1', 'n1srcb613pwjq3k1x73fpw37')
ORDER BY id DESC
LIMIT 8;
