"""Application configuration via pydantic-settings."""

from pydantic_settings import BaseSettings
from typing import Literal


class Settings(BaseSettings):
    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "dillame_scheduler"
    redis_url: str = "redis://localhost:6379/0"
    api_port: int = 8000
    worker_id: str = "worker-01"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    environment: Literal["development", "production", "test"] = "development"

    # Poll/worker config
    worker_poll_interval: int = 2  # seconds
    starvation_check_interval: int = 60  # seconds
    starvation_age_threshold: int = 300  # seconds a job must be pending before boost
    redis_lock_ttl: int = 30  # seconds
    lock_extend_threshold: int = 20  # seconds processing before extending lock
    lock_extend_by: int = 30  # seconds to extend
    dlq_threshold: int = 10  # count that triggers alert
    allowed_origins: list[str] = ["*"]
    
    alert_email: str = ""
    alert_email_password: str = ""
    alert_recipient: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
