import os
import json
import logging
from datetime import datetime, timedelta, timezone
from google.cloud import tasks_v2
from google.protobuf import timestamp_pb2

logger = logging.getLogger(__name__)

class TasksService:
    @classmethod
    def schedule_reminder(cls, uid: str, medication_name: str, dose_time_str: str, rxnorm_id: str):
        """Schedule a Cloud Task to hit the POST /api/tasks/reminder webhook at `dose_time_str`."""
        project = os.getenv("GOOGLE_CLOUD_PROJECT", "medlive-488722")
        location = os.getenv("CLOUD_TASKS_LOCATION", "us-central1")
        queue = os.getenv("CLOUD_TASKS_QUEUE", "medlive-reminders")
        target_url = os.getenv("BACKEND_URL", "https://medlive-demo.ngrok.app/api/tasks/reminder")
        
        # Parse time (format HH:MM)
        now = datetime.now(timezone.utc)
        try:
            d_time = datetime.strptime(dose_time_str, "%H:%M")
        except ValueError:
            logger.error(f"Invalid dose_time format: {dose_time_str}. Use HH:MM")
            return
            
        target_time = now.replace(hour=d_time.hour, minute=d_time.minute, second=0, microsecond=0)
        if target_time < now:
            target_time += timedelta(days=1)
            
        if not os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or os.getenv("MOCK_CLOUD_TASKS", "true").lower() == "true":
            logger.info(f"[MOCK] Cloud Task scheduled for '{medication_name}' at {target_time} (for user {uid})")
            return
            
        client = tasks_v2.CloudTasksClient()
        parent = client.queue_path(project, location, queue)
        
        timestamp = timestamp_pb2.Timestamp()
        timestamp.FromDatetime(target_time)
        
        payload = {
            "uid": uid,
            "medication_name": medication_name,
            "rxnorm_id": rxnorm_id,
            "dose_time": dose_time_str
        }
        
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": target_url,
                "headers": {"Content-type": "application/json"},
                "body": json.dumps(payload).encode(),
            },
            "schedule_time": timestamp
        }
        
        try:
            response = client.create_task(request={"parent": parent, "task": task})
            logger.info(f"Created Cloud Task: {response.name}")
            return response.name
        except Exception as e:
            logger.error(f"Failed to create Cloud Task: {e}")
