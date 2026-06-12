from .email_handler import handle_send_email
from .report_handler import handle_generate_report
from .upload_handler import handle_upload_file
from .webhook_handler import handle_webhook
from .log_handler import handle_log_processing

HANDLER_MAP = {
    "send_email": handle_send_email,
    "generate_report": handle_generate_report,
    "upload_file": handle_upload_file,
    "webhook": handle_webhook,
    "log_processing": handle_log_processing,
}

def get_handler(job_type: str):
    """Return the handler function for a given job type."""
    handler = HANDLER_MAP.get(job_type)
    if handler is None:
        raise ValueError(f"No handler registered for job type: {job_type}")
    return handler
