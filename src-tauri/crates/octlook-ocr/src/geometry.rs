//! Rotated rectangles around detected text.

pub type Point = (f32, f32);

/// A rotated rectangle: `axis` is the unit direction text runs along (never
/// pointing left), `width` its extent along `axis`, `height` across it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Quad {
    pub center: Point,
    pub axis: Point,
    pub width: f32,
    pub height: f32,
}

impl Quad {
    /// Unit direction across the text, pointing down the page.
    pub fn normal(&self) -> Point {
        (-self.axis.1, self.axis.0)
    }

    /// Point at fractions (u, v) ∈ [0, 1]² from the top-left corner along the axis and normal.
    pub fn at(&self, u: f32, v: f32) -> Point {
        let (n, (u, v)) = (self.normal(), ((u - 0.5) * self.width, (v - 0.5) * self.height));
        (self.center.0 + self.axis.0 * u + n.0 * v, self.center.1 + self.axis.1 * u + n.1 * v)
    }

    /// Top-left, top-right, bottom-right, bottom-left.
    pub fn corners(&self) -> [Point; 4] {
        [self.at(0.0, 0.0), self.at(1.0, 0.0), self.at(1.0, 1.0), self.at(0.0, 1.0)]
    }

    /// The same rectangle turned a quarter clockwise in reading terms, for
    /// vertical text: it then reads along what was the normal.
    pub fn turned(&self) -> Quad {
        Quad { axis: self.normal(), width: self.height, height: self.width, ..*self }
    }

    pub fn scaled(&self, s: f32) -> Quad {
        Quad { center: (self.center.0 * s, self.center.1 * s), width: self.width * s, height: self.height * s, ..*self }
    }

    /// Grown on every side by the DB "unclip" distance (area × ratio / perimeter).
    pub fn unclipped(&self, ratio: f32) -> Quad {
        let d = self.width * self.height * ratio / (2.0 * (self.width + self.height));
        Quad { width: self.width + 2.0 * d, height: self.height + 2.0 * d, ..*self }
    }
}

fn cross(o: Point, a: Point, b: Point) -> f32 {
    (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
}

/// Convex hull (monotone chain), counter-clockwise without collinear points.
fn hull(mut points: Vec<Point>) -> Vec<Point> {
    points.sort_by(|a, b| a.partial_cmp(b).unwrap());
    points.dedup();
    if points.len() < 3 {
        return points;
    }
    let mut lower: Vec<Point> = Vec::new();
    for &p in &points {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], p) <= 0.0 {
            lower.pop();
        }
        lower.push(p);
    }
    let mut upper: Vec<Point> = Vec::new();
    for &p in points.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], p) <= 0.0 {
            upper.pop();
        }
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

/// Minimum-area rectangle enclosing `points`; one of its sides lies on a hull edge.
pub fn min_area_rect(points: Vec<Point>) -> Option<Quad> {
    let hull = hull(points);
    if hull.len() < 3 {
        return None;
    }
    let mut best: Option<(f32, Quad)> = None;
    for i in 0..hull.len() {
        let (a, b) = (hull[i], hull[(i + 1) % hull.len()]);
        let length = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
        if length == 0.0 {
            continue;
        }
        let u = ((b.0 - a.0) / length, (b.1 - a.1) / length);
        let v = (-u.1, u.0);
        let (mut u0, mut u1, mut v0, mut v1) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
        for p in &hull {
            let (pu, pv) = (p.0 * u.0 + p.1 * u.1, p.0 * v.0 + p.1 * v.1);
            (u0, u1, v0, v1) = (u0.min(pu), u1.max(pu), v0.min(pv), v1.max(pv));
        }
        let area = (u1 - u0) * (v1 - v0);
        if best.as_ref().is_none_or(|(a, _)| area < *a) {
            let (cu, cv) = ((u0 + u1) / 2.0, (v0 + v1) / 2.0);
            let center = (u.0 * cu + v.0 * cv, u.1 * cu + v.1 * cv);
            best = Some((area, oriented(center, u, u1 - u0, v1 - v0)));
        }
    }
    best.map(|(_, quad)| quad)
}

/// The rectangle with its axis along whichever side is closer to horizontal, pointing right.
fn oriented(center: Point, u: Point, along: f32, across: f32) -> Quad {
    let (axis, width, height) = if u.0.abs() >= u.1.abs() { (u, along, across) } else { ((-u.1, u.0), across, along) };
    let axis = if axis.0 < 0.0 || (axis.0 == 0.0 && axis.1 > 0.0) { (-axis.0, -axis.1) } else { axis };
    Quad { center, axis, width, height }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotated_square_points_give_the_tight_rectangle() {
        // An axis-aligned 10 × 4 box.
        let points = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 4.0), (0.0, 4.0), (5.0, 2.0)];
        let q = min_area_rect(points).unwrap();
        assert!((q.width - 10.0).abs() < 1e-4 && (q.height - 4.0).abs() < 1e-4, "{q:?}");
        assert!((q.center.0 - 5.0).abs() < 1e-4 && (q.center.1 - 2.0).abs() < 1e-4);
        assert_eq!(q.axis, (1.0, 0.0));
        let [tl, _, br, _] = q.corners();
        assert!((tl.0, tl.1) == (0.0, 0.0) && (br.0 - 10.0).abs() < 1e-4 && (br.1 - 4.0).abs() < 1e-4);
    }

    #[test]
    fn tall_boxes_still_read_left_to_right() {
        let q = min_area_rect(vec![(0.0, 0.0), (3.0, 0.0), (3.0, 30.0), (0.0, 30.0)]).unwrap();
        assert!(q.axis.0 > 0.99 && (q.width - 3.0).abs() < 1e-4 && (q.height - 30.0).abs() < 1e-4, "{q:?}");
    }
}
