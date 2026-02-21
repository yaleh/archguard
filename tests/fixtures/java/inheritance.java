package com.example;

public class AdminUser extends User implements Service {
    private String role;

    public AdminUser(String name, int age, String role) {
        super(name, age);
        this.role = role;
    }

    public String getRole() {
        return role;
    }

    @Override
    public void start() {
        // implementation
    }

    @Override
    public void stop() {
        // implementation
    }

    @Override
    public boolean isRunning() {
        return true;
    }
}
