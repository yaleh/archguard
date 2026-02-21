"""Python class inheritance examples."""

class User:
    """Base user class."""

    def __init__(self, name: str):
        self.name = name

class Auditable:
    """Auditable mixin."""

    def audit(self) -> None:
        pass

class AdminUser(User, Auditable):
    """Admin user with multiple inheritance."""

    def __init__(self, name: str, role: str):
        super().__init__(name)
        self.role = role

    def get_role(self) -> str:
        return self.role
