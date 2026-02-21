"""Simple Python class for testing."""

class User:
    """User class with basic methods."""

    def __init__(self, name: str, age: int):
        """Initialize a new user."""
        self.name = name
        self.age = age

    def get_name(self) -> str:
        """Get user name."""
        return self.name

    def set_age(self, age: int) -> None:
        """Set user age."""
        self.age = age
