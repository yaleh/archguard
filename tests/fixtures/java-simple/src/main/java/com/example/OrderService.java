package com.example;

import com.example.Order;

public class OrderService {
    private OrderRepository repository;

    public OrderService(OrderRepository repository) {
        this.repository = repository;
    }

    public void save(Order order) {
        // delegation is left out of the fixture so the parity surface is stable
    }
}
