use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename = "image")]
pub struct ImageContent {
    pub data: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

pub fn validate(images: &[ImageContent]) -> Result<(), &'static str> {
    if images.len() > 10 {
        return Err("Attach at most 10 images per message");
    }
    for image in images {
        if !matches!(image.mime_type.as_str(), "image/jpeg" | "image/png" | "image/webp" | "image/gif") {
            return Err("Choose a JPEG, PNG, WebP or GIF image");
        }
        if image.data.is_empty() || image.data.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
            return Err("Image must be non-empty and at most 5 MiB");
        }
        let decoded = STANDARD.decode(&image.data).map_err(|_| "Invalid base64 image")?;
        if decoded.len() > MAX_IMAGE_BYTES {
            return Err("Image must be at most 5 MiB");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_rpc_format_and_validation() {
        let image = ImageContent { data: "aGVsbG8=".into(), mime_type: "image/png".into() };
        let value = serde_json::to_value(&image).unwrap();
        assert_eq!(value["type"], "image");
        assert_eq!(value["mimeType"], "image/png");
        assert!(validate(&[image.clone()]).is_ok());
        assert!(validate(&[image.clone(), image.clone()]).is_ok());
        assert!(validate(&vec![image.clone(); 10]).is_ok());
        assert!(validate(&vec![image; 11]).is_err());
        assert!(validate(&[]).is_ok());
        for data in ["", "bad", "===="] {
            assert!(validate(&[ImageContent { data: data.into(), mime_type: "image/png".into() }]).is_err());
        }
        assert!(validate(&[ImageContent { data: STANDARD.encode(vec![0; MAX_IMAGE_BYTES + 1]), mime_type: "image/png".into() }]).is_err());
        assert!(validate(&[ImageContent { data: "YQ==".into(), mime_type: "image/svg+xml".into() }]).is_err());
    }
}
