//! Bounded First Light replay shared by the authoritative root; no clock or reward inputs.
use near_sdk::near;
const LANES: [&str; 3] = ["left", "center", "right"];
const ITEMS: [&str; 5] = ["lens", "moth", "chart", "salvage", "vane"];

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Wave {
    pub turn: u8,
    pub source: String,
    pub lane: String,
    pub hit: bool,
    pub opened: bool,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Replay {
    pub area: String,
    pub orientation: u8,
    pub tool: String,
    pub lane: String,
    pub turn: u8,
    pub resolve: u8,
    pub uses: u8,
    pub locked: Option<String>,
    pub opened: Vec<String>,
    pub banked: Vec<String>,
    pub cargo: Vec<String>,
    pub actions: Vec<String>,
    pub waves: Vec<Wave>,
    pub outcome: String,
}

pub fn replay(
    tool: &str,
    banked: &[String],
    commands: &[String],
    area: &str,
) -> Result<Replay, String> {
    if !["rope", "lantern"].contains(&tool)
        || !["beacon", "wind"].contains(&area)
        || banked.len() > ITEMS.len()
        || commands.len() > 15
        || banked
            .iter()
            .enumerate()
            .any(|(i, item)| !ITEMS.contains(&item.as_str()) || banked[..i].contains(item))
    {
        return Err("ERR_REPLAY_INPUT".into());
    }
    let mut run = Replay {
        area: area.into(),
        orientation: u8::from(area == "wind"),
        tool: tool.into(),
        lane: "center".into(),
        turn: 0,
        resolve: 3,
        uses: 2,
        locked: None,
        opened: vec![],
        banked: banked.to_vec(),
        cargo: vec![],
        actions: vec![],
        waves: vec![],
        outcome: "active".into(),
    };
    for action in commands {
        if action.len() > 20 || !legal_actions(&run).contains(action) {
            return Err("ERR_ILLEGAL_COMMAND".into());
        }
        let phase = run.turn % 3;
        run.turn += 1;
        run.actions.push(action.clone());
        // A return extracts before the wave and action-fifteen flood.
        if action == "return" {
            run.outcome = "returned".into();
            continue;
        }
        if let Some((verb, target)) = action.split_once(':') {
            match verb {
                "move" => run.lane = target.into(),
                "lure" => {
                    run.locked = Some(target.into());
                    run.uses -= 1;
                }
                "take" => run.cargo.push(target.into()),
                "reel" => {
                    run.cargo.push(target.into());
                    run.uses -= 1;
                }
                "turn" => run.orientation = (run.orientation + 1) % 3,
                _ => return Err("ERR_ILLEGAL_COMMAND".into()),
            }
        }
        if phase == 1 {
            run.locked = Some(run.lane.clone());
        }
        if phase == 2
            && let Some(source) = run.locked.take()
        {
            let lane = LANES[(lane_index(&source) + usize::from(run.orientation)) % 3].to_owned();
            let hit = run.lane == lane;
            let objective = if area == "wind" {
                lane != "right"
            } else {
                lane != "center"
            };
            let opened = objective && !run.opened.contains(&lane);
            if hit {
                run.resolve -= 1;
            }
            if opened {
                run.opened.push(lane.clone());
            }
            run.waves.push(Wave {
                turn: run.turn,
                source,
                lane,
                hit,
                opened,
            });
        }
        if run.resolve == 0 || run.turn == 15 {
            run.cargo.clear();
            run.outcome = "rescued".into();
        }
    }
    Ok(run)
}
fn lane_index(lane: &str) -> usize {
    LANES.iter().position(|v| *v == lane).unwrap_or(1)
}
pub fn legal_actions(run: &Replay) -> Vec<String> {
    if run.outcome != "active" {
        return vec![];
    }
    let mut actions = vec!["wait".to_owned()];
    let position = lane_index(&run.lane);
    for (i, lane) in LANES.iter().enumerate() {
        if position.abs_diff(i) == 1 {
            actions.push(format!("move:{lane}"));
        }
    }
    if run.lane == "center" {
        actions.push("return".into());
        if run.area == "wind" {
            actions.push("turn:vane".into());
        }
    }
    if run.tool == "lantern" && run.uses > 0 && run.turn % 3 == 2 && run.locked.is_some() {
        actions.extend(LANES.iter().map(|lane| format!("lure:{lane}")));
    }
    for item in ITEMS {
        if (run.area == "wind") != (item == "vane")
            || run.banked.iter().chain(&run.cargo).any(|v| v == item)
        {
            continue;
        }
        let weight = |item: &str| if item == "moth" { 2 } else { 1 };
        if run.cargo.iter().map(|s| weight(s)).sum::<u8>() + weight(item) > 3 {
            continue;
        }
        let source = match item {
            "lens" | "salvage" => "left",
            "moth" => "right",
            _ => "center",
        };
        let exposed = match item {
            "vane" => {
                run.opened.iter().any(|s| s == "left") && run.opened.iter().any(|s| s == "center")
            }
            "chart" => run.tool == "lantern",
            _ => run.opened.iter().any(|s| s == source),
        };
        if !exposed {
            continue;
        }
        if source == run.lane {
            actions.push(format!("take:{item}"));
        } else if run.tool == "rope" && run.uses > 0 && ["lens", "salvage", "vane"].contains(&item)
        {
            actions.push(format!("reel:{item}"));
        }
    }
    actions
}

#[cfg(test)]
mod tests {
    use super::*;
    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| (*s).into()).collect()
    }
    #[test]
    fn five_action_route_and_terminal_extraction_are_exact() {
        let run = replay(
            "rope",
            &[],
            &strings(&["move:left", "wait", "move:center", "reel:lens", "return"]),
            "beacon",
        )
        .unwrap();
        assert_eq!(run.cargo, strings(&["lens"]));
        assert_eq!(run.resolve, 3);
        assert_eq!(run.turn, 5);
        assert_eq!(run.outcome, "returned");
        assert!(replay("rope", &[], &strings(&["return", "wait"]), "beacon").is_err());
    }
    #[test]
    fn malformed_inputs_and_post_terminal_actions_fail() {
        for (tool, bank, commands, area) in [
            ("other", vec![], vec![], "beacon"),
            ("rope", vec![], vec![], "elsewhere"),
            ("rope", strings(&["lens", "lens"]), vec![], "beacon"),
            (
                "rope",
                vec![],
                strings(&["move:right", "move:left"]),
                "beacon",
            ),
            ("rope", vec![], vec!["wait".into(); 16], "beacon"),
            ("rope", vec![], strings(&["take:moth"]), "beacon"),
        ] {
            assert!(replay(tool, &bank, &commands, area).is_err());
        }
    }
}

#[cfg(test)]
mod differential_tests {
    use super::*;
    use near_sdk::serde::Deserialize;
    #[derive(Deserialize)]
    #[serde(crate = "near_sdk::serde")]
    struct Fixture {
        tool: String,
        banked: Vec<String>,
        area: String,
        commands: Vec<String>,
        states: Vec<String>,
    }
    #[test]
    fn every_intermediate_state_matches_the_browser_rules() {
        let fixtures: Vec<Fixture> =
            near_sdk::serde_json::from_str(include_str!("../tests/expedition-fixtures.json"))
                .unwrap();
        for (i, f) in fixtures.iter().enumerate() {
            for n in 0..=f.commands.len() {
                let actual = replay(&f.tool, &f.banked, &f.commands[..n], &f.area).unwrap();
                let value =
                    near_sdk::serde_json::to_value((&actual, legal_actions(&actual))).unwrap();
                fn canonical(v: &near_sdk::serde_json::Value) -> String {
                    use near_sdk::serde_json::Value;
                    match v {
                        Value::Object(map) => {
                            let mut keys = map.keys().collect::<Vec<_>>();
                            keys.sort();
                            format!(
                                "{{{}}}",
                                keys.into_iter()
                                    .map(|k| format!(
                                        "{}:{}",
                                        near_sdk::serde_json::to_string(k).unwrap(),
                                        canonical(&map[k])
                                    ))
                                    .collect::<Vec<_>>()
                                    .join(",")
                            )
                        }
                        Value::Array(values) => format!(
                            "[{}]",
                            values.iter().map(canonical).collect::<Vec<_>>().join(",")
                        ),
                        _ => near_sdk::serde_json::to_string(v).unwrap(),
                    }
                }
                let bytes = canonical(&value).into_bytes();
                let hash = near_sdk::env::sha256(&bytes)
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect::<String>();
                assert_eq!(hash, f.states[n], "fixture {i} step {n}");
            }
        }
    }
}
