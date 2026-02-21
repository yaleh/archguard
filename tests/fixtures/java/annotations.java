package com.example;

@Deprecated
public class LegacyService implements Service {

    @Override
    public void start() {
        // implementation
    }

    @Override
    @Deprecated
    public void stop() {
        // old implementation
    }

    @Override
    public boolean isRunning() {
        return false;
    }
}
