"""Run the trusted single-concurrency Redis-to-spool dispatcher."""
from redis import Redis
from rq import Queue, SimpleWorker

from app.config import config


def main() -> None:
    connection = Redis.from_url(config.MANIM_REDIS_URL)
    queue = Queue(config.MANIM_QUEUE, connection=connection)
    SimpleWorker([queue], connection=connection).work(with_scheduler=False)


if __name__ == "__main__":
    main()
