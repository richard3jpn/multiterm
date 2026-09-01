/// WebSocket / CORS のOrigin検証（RDD.md 5章9項）。
///
/// クロスオリジンWS・DNSリバインディング経由のRCEを防ぐため、
/// ホワイトリスト完全一致のみ許可し、Originヘッダなしは拒否する。
pub fn parse_allowed_origins(raw: Option<&str>) -> Vec<String> {
    raw.unwrap_or("")
        .split(',')
        .map(|origin| origin.trim())
        .filter(|origin| !origin.is_empty())
        .map(|origin| origin.to_string())
        .collect()
}

pub fn is_origin_allowed(origin: Option<&str>, allowed_origins: &[String]) -> bool {
    match origin {
        Some(value) => allowed_origins.iter().any(|allowed| allowed == value),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_comma_separated_and_trims() {
        let parsed = parse_allowed_origins(Some(" http://a.example , http://b.example "));
        assert_eq!(parsed, vec!["http://a.example", "http://b.example"]);
    }

    #[test]
    fn drops_empty_entries() {
        assert_eq!(parse_allowed_origins(Some("a,,b,")), vec!["a", "b"]);
        assert!(parse_allowed_origins(Some("")).is_empty());
        assert!(parse_allowed_origins(None).is_empty());
    }

    #[test]
    fn allows_only_exact_match() {
        let allowed = parse_allowed_origins(Some("http://127.0.0.1:5174"));
        assert!(is_origin_allowed(Some("http://127.0.0.1:5174"), &allowed));
        assert!(!is_origin_allowed(Some("http://127.0.0.1:5175"), &allowed));
        assert!(!is_origin_allowed(Some("http://evil.example"), &allowed));
    }

    #[test]
    fn rejects_missing_origin() {
        let allowed = parse_allowed_origins(Some("http://127.0.0.1:5174"));
        assert!(!is_origin_allowed(None, &allowed));
    }
}
