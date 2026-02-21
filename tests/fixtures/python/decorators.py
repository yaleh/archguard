"""Python decorators examples."""

class Service:
    """Service with various decorated methods."""

    def __init__(self, name: str):
        self._name = name

    @property
    def name(self) -> str:
        """Name property."""
        return self._name

    @name.setter
    def name(self, value: str) -> None:
        """Name setter."""
        self._name = value

    @classmethod
    def create(cls, name: str):
        """Create a new service."""
        return cls(name)

    @staticmethod
    def validate(value: str) -> bool:
        """Validate a string value."""
        return len(value) > 0
