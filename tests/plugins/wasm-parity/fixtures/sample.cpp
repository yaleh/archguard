#include <string>
#include <vector>
#include <memory>

namespace geometry {

class Shape {
public:
    virtual ~Shape() = default;
    virtual double area() const = 0;
    virtual std::string name() const { return "shape"; }

protected:
    double scale_ = 1.0;
};

class Circle : public Shape {
public:
    explicit Circle(double radius) : radius_(radius) {}
    double area() const override { return 3.14159 * radius_ * radius_; }
    std::string name() const override { return "circle"; }

private:
    double radius_;
};

template <typename T>
class Registry {
public:
    void add(std::unique_ptr<T> item) { items_.push_back(std::move(item)); }
    std::size_t size() const { return items_.size(); }

private:
    std::vector<std::unique_ptr<T>> items_;
};

} // namespace geometry

int main() {
    geometry::Registry<geometry::Shape> registry;
    registry.add(std::make_unique<geometry::Circle>(2.0));
    return static_cast<int>(registry.size());
}
