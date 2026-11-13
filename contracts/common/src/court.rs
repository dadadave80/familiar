//! Versioned spatial replay. This transient state never changes deployed Borsh account layouts.
use near_sdk::near;
pub const CONTENT_VERSION: &str = "first_light_v2";
pub const TURN_LIMIT: u8 = 24;
const BANKED: [&str; 5] = ["lens", "moth", "chart", "salvage", "vane"];
const LANES: [&str; 3] = ["left", "center", "right"];

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Position {
    pub x: u8,
    pub y: u8,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub content_version: String,
    pub area: String,
    pub tool: String,
    pub banked: Vec<String>,
    pub position: Position,
    pub turn: u8,
    pub resolve: u8,
    pub uses: u8,
    pub orientation: u8,
    pub locked: Option<u8>,
    pub bridge: u8,
    pub opened: Vec<u8>,
    pub cargo: Vec<String>,
    pub commands: Vec<String>,
    pub outcome: String,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Event {
    Move {
        from: Position,
        to: Position,
    },
    Telegraph {
        column: u8,
    },
    Redirect {
        from: u8,
        to: u8,
    },
    Rotate {
        from: u8,
        to: u8,
    },
    Wave {
        source: u8,
        exit: u8,
    },
    Bridge {
        from: u8,
        to: u8,
    },
    Open {
        column: u8,
    },
    Hit {
        from: Position,
        to: Position,
        resolve: u8,
    },
    Pickup {
        item: String,
        from: Position,
        rope: bool,
    },
    Return {
        cargo: Vec<String>,
    },
    Rescue {
        reason: String,
    },
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transition {
    pub before: State,
    pub after: State,
    pub events: Vec<Event>,
}

pub fn start(tool: &str, banked: &[String], area: &str) -> Result<State, String> {
    if !["rope", "lantern"].contains(&tool)
        || !["beacon", "wind"].contains(&area)
        || banked.len() > BANKED.len()
        || banked
            .iter()
            .enumerate()
            .any(|(i, s)| !BANKED.contains(&s.as_str()) || banked[..i].contains(s))
    {
        return Err("ERR_REPLAY_INPUT".into());
    }
    Ok(State {
        content_version: CONTENT_VERSION.into(),
        area: area.into(),
        tool: tool.into(),
        banked: banked.to_vec(),
        position: Position { x: 1, y: 0 },
        turn: 0,
        resolve: 3,
        uses: 2,
        orientation: u8::from(area == "wind"),
        locked: None,
        bridge: 1,
        opened: vec![],
        cargo: vec![],
        commands: vec![],
        outcome: "active".into(),
    })
}
pub fn replay(
    tool: &str,
    banked: &[String],
    commands: &[String],
    area: &str,
) -> Result<State, String> {
    if commands.len() > usize::from(TURN_LIMIT) || commands.iter().any(|s| s.len() > 20) {
        return Err("ERR_REPLAY_INPUT".into());
    }
    let mut run = start(tool, banked, area)?;
    for command in commands {
        run = apply_command(&run, command)
            .ok_or("ERR_ILLEGAL_COMMAND")?
            .after;
    }
    Ok(run)
}
fn passable(position: &Position, bridge: u8) -> bool {
    position.x < 3 && position.y < 5 && (position.y != 2 || position.x == bridge)
}
fn step(position: &Position, direction: &str, bridge: u8) -> Option<Position> {
    let (dx, dy) = match direction {
        "north" => (0, 1),
        "south" => (0, -1),
        "west" => (-1, 0),
        "east" => (1, 0),
        _ => return None,
    };
    // Row two is a traversed bridge edge, never an end-of-command resting tile.
    if (direction == "north" && position.y == 1) || (direction == "south" && position.y == 3) {
        return (position.x == bridge).then_some(Position {
            x: position.x,
            y: if direction == "north" { 3 } else { 1 },
        });
    }
    let (x, y) = (i16::from(position.x) + dx, i16::from(position.y) + dy);
    if !(0..3).contains(&x) || !(0..5).contains(&y) {
        return None;
    }
    Some(Position {
        x: x as u8,
        y: y as u8,
    })
}
fn item_position(item: &str) -> Position {
    Position {
        x: match item {
            "lens" => 0,
            "moth" => 2,
            _ => 1,
        },
        y: 4,
    }
}
fn weight(item: &str) -> u8 {
    if item == "moth" { 2 } else { 1 }
}
pub fn legal_actions(run: &State) -> Vec<String> {
    if run.outcome != "active" || run.turn >= TURN_LIMIT || run.resolve == 0 {
        return vec![];
    }
    let mut commands = vec!["wait".into()];
    for direction in ["north", "south", "west", "east"] {
        if step(&run.position, direction, run.bridge).is_some_and(|p| passable(&p, run.bridge)) {
            commands.push(format!("step:{direction}"));
        }
    }
    if run.position == (Position { x: 1, y: 0 }) {
        commands.push("return".into());
    }
    if run.area == "wind" && run.position == (Position { x: 1, y: 3 }) {
        commands.push("turn:vane".into());
    }
    if run.tool == "lantern" && run.uses > 0 && run.turn % 3 == 2 && run.locked.is_some() {
        commands.extend(LANES.map(|lane| format!("lure:{lane}")));
    }
    for item in ["lens", "moth", "vane"] {
        if (run.area == "wind") != (item == "vane")
            || run.banked.iter().chain(&run.cargo).any(|s| s == item)
            || run.cargo.iter().map(|s| weight(s)).sum::<u8>() + weight(item) > 3
        {
            continue;
        }
        let position = item_position(item);
        let exposed = if item == "vane" {
            run.opened.contains(&0) && run.opened.contains(&1) && run.orientation == 0
        } else {
            run.opened.contains(&position.x)
        };
        if !exposed {
            continue;
        }
        let distance = run.position.x.abs_diff(position.x) + run.position.y.abs_diff(position.y);
        if distance <= 1 {
            commands.push(format!("take:{item}"));
        } else if distance <= 2 && run.tool == "rope" && run.uses > 0 && item != "moth" {
            commands.push(format!("reel:{item}"));
        }
    }
    commands
}
pub fn apply_command(run: &State, command: &str) -> Option<Transition> {
    if !legal_actions(run).iter().any(|s| s == command) {
        return None;
    }
    let mut next = run.clone();
    let mut events = vec![];
    next.turn += 1;
    next.commands.push(command.into());
    if command == "return" {
        next.outcome = "returned".into();
        events.push(Event::Return {
            cargo: next.cargo.clone(),
        });
        return Some(Transition {
            before: run.clone(),
            after: next,
            events,
        });
    }
    if let Some((verb, target)) = command.split_once(':') {
        match verb {
            "step" => {
                let to = step(&run.position, target, run.bridge)?;
                events.push(Event::Move {
                    from: run.position.clone(),
                    to: to.clone(),
                });
                next.position = to;
            }
            "turn" => {
                next.orientation = (run.orientation + 1) % 3;
                events.push(Event::Rotate {
                    from: run.orientation,
                    to: next.orientation,
                });
            }
            "lure" => {
                let to = LANES.iter().position(|s| *s == target)? as u8;
                events.push(Event::Redirect {
                    from: run.locked?,
                    to,
                });
                next.locked = Some(to);
                next.uses -= 1;
            }
            "take" | "reel" => {
                next.cargo.push(target.into());
                let rope = verb == "reel";
                if rope {
                    next.uses -= 1;
                }
                events.push(Event::Pickup {
                    item: target.into(),
                    from: item_position(target),
                    rope,
                });
            }
            _ => return None,
        }
    }
    if run.turn % 3 == 1 {
        next.locked = Some(next.position.x);
        events.push(Event::Telegraph {
            column: next.position.x,
        });
    }
    if run.turn % 3 == 2
        && let Some(source) = next.locked.take()
    {
        let exit = (source + next.orientation) % 3;
        events.push(Event::Wave { source, exit });
        if next.bridge != exit {
            events.push(Event::Bridge {
                from: next.bridge,
                to: exit,
            });
            next.bridge = exit;
        }
        let objective = if next.area == "wind" {
            exit != 2
        } else {
            exit != 1
        };
        if objective && !next.opened.contains(&exit) {
            next.opened.push(exit);
            events.push(Event::Open { column: exit });
        }
        if next.position.x == exit || !passable(&next.position, next.bridge) {
            next.resolve -= 1;
            let from = next.position.clone();
            if next.position.y == 2 {
                next.position.y = 1;
            } else if next.position.y > 0 {
                next.position.y -= 1;
                while next.position.y > 0
                    && (next.position.y == 2 || !passable(&next.position, next.bridge))
                {
                    next.position.y -= 1;
                }
            }
            events.push(Event::Hit {
                from,
                to: next.position.clone(),
                resolve: next.resolve,
            });
        }
    }
    if next.resolve == 0 || next.turn == TURN_LIMIT {
        next.cargo.clear();
        next.outcome = "rescued".into();
        events.push(Event::Rescue {
            reason: if next.resolve == 0 {
                "resolve"
            } else {
                "flood"
            }
            .into(),
        });
    }
    Some(Transition {
        before: run.clone(),
        after: next,
        events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn strings(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| (*s).into()).collect()
    }
    #[test]
    fn spatial_start_and_dock_extraction_preserve_legacy_banked_items() {
        let run = replay(
            "rope",
            &strings(&["chart", "salvage"]),
            &strings(&["return"]),
            "beacon",
        )
        .unwrap();
        assert_eq!(run.position, Position { x: 1, y: 0 });
        assert_eq!(run.banked, strings(&["chart", "salvage"]));
        assert_eq!(run.outcome, "returned");
        assert_eq!(run.turn, 1);
        assert_eq!(run.resolve, 3);
    }
    #[test]
    fn adjacency_bridge_and_rising_mark_use_the_resulting_position() {
        let initial = start("rope", &[], "beacon").unwrap();
        assert!(apply_command(&initial, "step:south").is_none());
        let left = apply_command(&initial, "step:west").unwrap().after;
        let lower = apply_command(&left, "step:north").unwrap();
        assert_eq!(lower.after.locked, Some(0));
        assert_eq!(
            lower.events,
            vec![
                Event::Move {
                    from: Position { x: 0, y: 0 },
                    to: Position { x: 0, y: 1 }
                },
                Event::Telegraph { column: 0 }
            ]
        );
        assert!(
            !legal_actions(&lower.after).contains(&"step:north".into()),
            "Closed bridge is not walkable"
        );
    }
    #[test]
    fn bridge_is_a_single_traversal_edge_and_allows_a_deliberate_dry_lens_route() {
        let commands = strings(&[
            "step:north",
            "step:north",
            "step:west",
            "wait",
            "wait",
            "step:east",
            "reel:lens",
            "step:west",
            "step:east",
            "step:west",
            "step:south",
            "step:east",
            "step:south",
            "return",
        ]);
        let crossing = replay("rope", &[], &commands[..2], "beacon").unwrap();
        assert_eq!(crossing.position, Position { x: 1, y: 3 });
        let run = replay("rope", &[], &commands, "beacon").unwrap();
        assert_eq!(run.outcome, "returned");
        assert_eq!(run.cargo, strings(&["lens"]));
        assert_eq!(run.resolve, 3);
        for n in 0..=commands.len() {
            assert_ne!(
                replay("rope", &[], &commands[..n], "beacon")
                    .unwrap()
                    .position
                    .y,
                2
            );
        }
    }
    #[test]
    fn bridge_washout_and_wave_damage_are_one_hit_with_a_lower_safe_tile() {
        let mut run = start("rope", &[], "beacon").unwrap();
        run.turn = 2;
        run.locked = Some(0);
        run.position = Position { x: 1, y: 2 };
        run.cargo = strings(&["lens"]);
        let next = apply_command(&run, "wait").unwrap();
        assert_eq!(next.after.resolve, 2);
        assert_eq!(next.after.position, Position { x: 1, y: 1 });
        assert_eq!(next.after.cargo, run.cargo);
        assert_eq!(
            next.events,
            vec![
                Event::Wave { source: 0, exit: 0 },
                Event::Bridge { from: 1, to: 0 },
                Event::Open { column: 0 },
                Event::Hit {
                    from: run.position,
                    to: Position { x: 1, y: 1 },
                    resolve: 2
                }
            ]
        );
        let mut dock = start("rope", &[], "beacon").unwrap();
        dock.turn = 2;
        dock.locked = Some(1);
        let hit = apply_command(&dock, "wait").unwrap().after;
        assert_eq!(hit.position, dock.position);
        assert_eq!(hit.resolve, 2);
    }
    #[test]
    fn return_precedes_wave_and_flood_but_rescue_drops_a_same_turn_pickup() {
        let mut run = start("rope", &[], "beacon").unwrap();
        run.turn = 23;
        run.locked = Some(1);
        run.cargo = strings(&["lens"]);
        run.resolve = 1;
        let returned = apply_command(&run, "return").unwrap();
        assert_eq!(returned.after.outcome, "returned");
        assert_eq!(returned.after.cargo, run.cargo);
        assert_eq!(returned.events.len(), 1);
        run.position = Position { x: 0, y: 3 };
        run.opened = vec![0];
        run.cargo.clear();
        let rescued = apply_command(&run, "take:lens").unwrap();
        assert_eq!(rescued.after.outcome, "rescued");
        assert!(rescued.after.cargo.is_empty());
        assert!(matches!(rescued.events.first(), Some(Event::Pickup { .. })));
        assert_eq!(
            rescued.events.last(),
            Some(&Event::Rescue {
                reason: "flood".into()
            })
        );
        assert!(legal_actions(&rescued.after).is_empty());
    }
    #[test]
    fn tool_range_capacity_and_wind_rotation_are_explicit_decisions() {
        let mut run = start("rope", &[], "beacon").unwrap();
        run.position = Position { x: 1, y: 3 };
        run.opened = vec![0, 2];
        assert!(legal_actions(&run).contains(&"reel:lens".into()));
        assert!(!legal_actions(&run).contains(&"take:lens".into()));
        assert!(!legal_actions(&run).contains(&"reel:moth".into()));
        run.position = Position { x: 0, y: 3 };
        assert!(legal_actions(&run).contains(&"take:lens".into()));
        assert!(!legal_actions(&run).contains(&"reel:lens".into()));
        run.position = Position { x: 2, y: 3 };
        run.cargo = strings(&["lens"]);
        assert!(legal_actions(&run).contains(&"take:moth".into()));
        run.cargo.push("vane".into());
        assert!(!legal_actions(&run).contains(&"take:moth".into()));
        let mut wind = start("lantern", &[], "wind").unwrap();
        wind.turn = 2;
        wind.locked = Some(0);
        wind.position = Position { x: 1, y: 3 };
        let turn = apply_command(&wind, "turn:vane").unwrap();
        assert_eq!(turn.after.orientation, 2);
        assert!(matches!(turn.events[0], Event::Rotate { from: 1, to: 2 }));
        assert!(matches!(turn.events[1], Event::Wave { source: 0, exit: 2 }));
        let lure = apply_command(&wind, "lure:right").unwrap();
        assert_eq!(lure.after.uses, 1);
        assert!(matches!(lure.events[0], Event::Redirect { from: 0, to: 2 }));
        assert!(matches!(lure.events[1], Event::Wave { source: 2, exit: 0 }));
    }
    #[test]
    fn charged_wind_sockets_require_the_actual_zero_alignment_before_the_vane_is_exposed() {
        let mut run = start("lantern", &[], "wind").unwrap();
        run.position = Position { x: 1, y: 3 };
        run.opened = vec![0, 1];
        assert!(!legal_actions(&run).contains(&"take:vane".into()));
        run = apply_command(&run, "turn:vane").unwrap().after;
        assert_eq!(run.orientation, 2);
        assert!(!legal_actions(&run).contains(&"take:vane".into()));
        run = apply_command(&run, "turn:vane").unwrap().after;
        assert_eq!(run.orientation, 0);
        assert!(legal_actions(&run).contains(&"take:vane".into()));
    }
    #[test]
    fn version_two_rejects_old_commands_malformed_context_and_post_terminal_input() {
        for (tool, bank, commands, area) in [
            ("rope", vec![], strings(&["move:left"]), "beacon"),
            ("rope", vec![], strings(&["return", "wait"]), "beacon"),
            ("rope", vec![], vec!["wait".into(); 25], "beacon"),
            ("else", vec![], vec![], "beacon"),
            ("rope", strings(&["lens", "lens"]), vec![], "beacon"),
            ("rope", vec![], vec![], "else"),
        ] {
            assert!(replay(tool, &bank, &commands, area).is_err());
        }
    }
}

#[cfg(test)]
mod differential_tests {
    use super::*;
    use near_sdk::{
        serde::Deserialize,
        serde_json::{self, Value},
    };
    #[derive(Deserialize)]
    #[serde(crate = "near_sdk::serde")]
    struct Start {
        area: String,
        tool: String,
        banked: Vec<String>,
    }
    #[derive(Deserialize)]
    #[serde(crate = "near_sdk::serde")]
    struct Case {
        id: String,
        start: Start,
        commands: Vec<String>,
        states: Vec<Value>,
        legal: Vec<Vec<String>>,
        events: Vec<Value>,
    }
    #[derive(Deserialize)]
    #[serde(crate = "near_sdk::serde")]
    struct Fixtures {
        version: String,
        cases: Vec<Case>,
    }
    #[test]
    fn every_court_intermediate_state_legal_order_and_event_matches_the_browser() {
        let fixtures: Fixtures =
            serde_json::from_str(include_str!("../fixtures/court.json")).unwrap();
        assert_eq!(fixtures.version, CONTENT_VERSION);
        assert_eq!(fixtures.cases.len(), 134);
        let mut count = 0;
        for case in fixtures.cases {
            assert_eq!(case.states.len(), case.commands.len() + 1);
            assert_eq!(case.legal.len(), case.states.len());
            assert_eq!(case.events.len(), case.commands.len());
            for n in 0..=case.commands.len() {
                let state = replay(
                    &case.start.tool,
                    &case.start.banked,
                    &case.commands[..n],
                    &case.start.area,
                )
                .unwrap();
                assert_eq!(
                    serde_json::to_value(&state).unwrap(),
                    case.states[n],
                    "{} state {n}",
                    case.id
                );
                assert_eq!(
                    legal_actions(&state),
                    case.legal[n],
                    "{} legal {n}",
                    case.id
                );
                assert_ne!(state.position.y, 2, "bridge is not a resting tile");
                if n < case.commands.len() {
                    let transition = apply_command(&state, &case.commands[n]).unwrap();
                    assert_eq!(
                        serde_json::to_value(transition.events).unwrap(),
                        case.events[n],
                        "{} events {n}",
                        case.id
                    );
                }
                count += 1;
            }
        }
        assert_eq!(count, 2735);
    }
}
