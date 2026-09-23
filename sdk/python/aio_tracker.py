import time
import uuid
import platform
import requests

class AIOTracker:
    """
    All-in-One Analytics Client cho Python, FastAPI, Flask, hoặc CLI Tools.
    Cách dùng:
    ```python
    from aio_tracker import AIOTracker
    tracker = AIOTracker("http://localhost:3000", "my-python-api", "My Python API Service")
    tracker.track_event("order_processed", {"amount": 250000, "status": "success"})
    ```
    """
    def __init__(self, server_url: str, project_id: str, app_name: str = None):
        self.server_url = server_url.rstrip('/')
        self.project_id = project_id
        self.app_name = app_name or project_id
        self.session_id = f"py_{uuid.uuid4().hex[:10]}"
        self.os_name = f"{platform.system()} {platform.release()}"

        # Gửi sự kiện khởi động
        self.track_event("service_start", {"python_version": platform.python_version()})

    def track_event(self, event_name: str, properties: dict = None, path: str = "/"):
        payload = {
            "projectId": self.project_id,
            "projectName": self.app_name,
            "sessionId": self.session_id,
            "platform": "backend",
            "eventType": "custom",
            "eventName": event_name,
            "path": path,
            "os": self.os_name,
            "browser": f"Python {platform.python_version()}",
            "properties": properties or {},
            "clientSdk": "python"
        }
        self._send("/api/v1/track", payload)

    def track_error(self, error: Exception, context: str = ""):
        payload = {
            "projectId": self.project_id,
            "sessionId": self.session_id,
            "platform": "backend",
            "eventType": "error",
            "eventName": "Python Exception",
            "path": context,
            "error": {
                "message": str(error),
                "stack": getattr(error, '__traceback__', '')
            },
            "clientSdk": "python"
        }
        self._send("/api/v1/track", payload)

    def heartbeat(self):
        self._send("/api/v1/heartbeat", {
            "projectId": self.project_id,
            "sessionId": self.session_id
        })

    def _send(self, endpoint: str, data: dict):
        try:
            requests.post(
                f"{self.server_url}{endpoint}",
                json=data,
                headers={"X-Platform": "backend", "X-Client-Sdk": "python"},
                timeout=2.5
            )
        except Exception:
            pass
