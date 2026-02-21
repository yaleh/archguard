"""Python type hints examples."""
from typing import List, Dict, Optional, Union

class DataProcessor:
    """Data processor with type hints."""

    def process_items(self, items: List[str]) -> Dict[str, int]:
        """Process a list of items."""
        return {item: len(item) for item in items}

    def find_item(self, key: str) -> Optional[str]:
        """Find an item by key."""
        return None

    def merge(self, data: Union[str, int]) -> str:
        """Merge data."""
        return str(data)
