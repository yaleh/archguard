"""Async functions examples."""
import asyncio

async def fetch_data(url: str) -> dict:
    """Fetch data asynchronously."""
    await asyncio.sleep(1)
    return {"url": url, "status": "ok"}

class AsyncService:
    """Service with async methods."""

    async def process(self, data: str) -> str:
        """Process data asynchronously."""
        await asyncio.sleep(0.1)
        return data.upper()

    async def fetch_multiple(self, urls: list) -> list:
        """Fetch multiple URLs."""
        tasks = [fetch_data(url) for url in urls]
        return await asyncio.gather(*tasks)
