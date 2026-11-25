//! Reading order: lines grouped into rows top to bottom, left to right within a row.

use crate::Line;

/// Two lines share a row when their vertical extents overlap by this much of the shorter one…
const SAME_ROW: f32 = 0.5;
/// …and are at most this many line heights apart; farther apart they are separate columns.
const MAX_GAP: f32 = 3.0;
/// A gap between CJK glyphs narrower than this many line heights is not a word break.
const CJK_GAP: f32 = 0.6;

/// Horizontal extent of a line and the vertical band its glyphs occupy.
struct Bounds {
    x0: f32,
    x1: f32,
    y0: f32,
    y1: f32,
    /// Vertical text forms a row of its own.
    vertical: bool,
}

fn bounds(line: &Line) -> Bounds {
    let q = &line.quad;
    let xs = q.corners().map(|p| p.0);
    // The band ignores a slight tilt, which would otherwise make the line look as tall as it is long.
    let half = q.height / 2.0;
    Bounds {
        x0: xs.into_iter().fold(f32::MAX, f32::min),
        x1: xs.into_iter().fold(f32::MIN, f32::max),
        y0: q.center.1 - half,
        y1: q.center.1 + half,
        vertical: q.height >= q.width * crate::rec::VERTICAL,
    }
}

/// Whether `b` continues `row`: overlapping it vertically and near one of its lines.
fn continues(row: &[(Bounds, Line)], b: &Bounds) -> bool {
    !b.vertical
        && row.iter().any(|(r, _)| {
            let height = (b.y1 - b.y0).min(r.y1 - r.y0);
            let overlap = b.y1.min(r.y1) - b.y0.max(r.y0);
            let gap = (b.x0 - r.x1).max(r.x0 - b.x1);
            !r.vertical && overlap >= SAME_ROW * height && gap <= MAX_GAP * height
        })
}

/// `lines` as rows, each sorted left to right, the rows top to bottom.
fn rows(lines: Vec<Line>) -> Vec<Vec<(Bounds, Line)>> {
    let mut items: Vec<(Bounds, Line)> = lines.into_iter().map(|l| (bounds(&l), l)).collect();
    items.sort_by(|a, b| (a.0.y0 + a.0.y1).total_cmp(&(b.0.y0 + b.0.y1)));
    let mut rows: Vec<Vec<(Bounds, Line)>> = Vec::new();
    for item in items {
        match rows.iter_mut().rev().take(8).find(|row| continues(row, &item.0)) {
            Some(row) => row.push(item),
            None => rows.push(vec![item]),
        }
    }
    for row in &mut rows {
        row.sort_by(|a, b| a.0.x0.total_cmp(&b.0.x0));
    }
    rows
}

pub fn reading_order(lines: Vec<Line>) -> Vec<Line> {
    rows(lines).into_iter().flatten().map(|(_, line)| line).collect()
}

fn is_cjk(c: char) -> bool {
    matches!(c, '\u{3000}'..='\u{303f}' | '\u{3400}'..='\u{9fff}' | '\u{f900}'..='\u{faff}' | '\u{ff00}'..='\u{ffef}')
}

/// Plain text: one row per text line, pieces of a row joined as a reader would.
pub fn to_text(lines: &[Line]) -> String {
    rows(lines.to_vec())
        .iter()
        .map(|row| {
            let mut text = String::new();
            for (i, (b, line)) in row.iter().enumerate() {
                if let Some((prev, prev_line)) = i.checked_sub(1).map(|j| &row[j]) {
                    let height = (b.y1 - b.y0).min(prev.y1 - prev.y0);
                    let joined = prev_line.text.chars().last().is_some_and(is_cjk)
                        && line.text.chars().next().is_some_and(is_cjk)
                        && b.x0 - prev.x1 < CJK_GAP * height;
                    if !joined {
                        text.push(' ');
                    }
                }
                text.push_str(&line.text);
            }
            text
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Quad;

    fn line(text: &str, x: f32, y: f32, width: f32) -> Line {
        Line { text: text.into(), score: 1.0, quad: Quad { center: (x + width / 2.0, y + 10.0), axis: (1.0, 0.0), width, height: 20.0 } }
    }

    #[test]
    fn rows_read_top_down_and_left_to_right() {
        let lines = vec![line("world", 120.0, 2.0, 60.0), line("second", 0.0, 40.0, 80.0), line("hello", 0.0, 0.0, 60.0), line("设计", 0.0, 80.0, 40.0), line("师", 44.0, 81.0, 20.0)];
        assert_eq!(to_text(&lines), "hello world\nsecond\n设计师");
    }
}
