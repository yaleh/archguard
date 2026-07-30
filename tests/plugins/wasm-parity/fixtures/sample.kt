package com.example.shapes

import kotlin.math.PI

interface Shape {
    fun area(): Double
    fun name(): String = "shape"
}

abstract class ScaledShape(protected var scale: Double) : Shape {
    abstract fun describe(): String
}

class Circle(private val radius: Double) : ScaledShape(1.0) {
    override fun area(): Double = PI * radius * radius
    override fun name(): String = "circle"
    override fun describe(): String = "circle r=$radius scale=$scale"
}

data class Size(val width: Double, val height: Double)

sealed class Result {
    data class Ok(val value: Double) : Result()
    data class Err(val message: String) : Result()
}

object ShapeFactory {
    fun circle(radius: Double): Shape = Circle(radius)
}

fun main() {
    val shapes = listOf(ShapeFactory.circle(2.0), Circle(3.0))
    val total = shapes.fold(0.0) { acc, shape -> acc + shape.area() }
    println(total)
}
