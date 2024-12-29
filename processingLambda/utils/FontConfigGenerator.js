const fs = require("fs");
const path = require("path");

class FontConfigGenerator {
  constructor() {
    this.fontsDir = "/var/task/fonts";
    this.cacheDir = "/tmp/fonts-cache";
    this.configDir = "/var/task/config";
    this.tmpConfigPath = "/tmp/fonts.conf"; // Modify to use /tmp directory
  }

  initialize() {
    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    // Set environment variables
    process.env.FONTCONFIG_PATH = "/tmp";
    process.env.FONTCONFIG_FILE = "fonts.conf";

    // Copy fonts.conf to Lambda root if it doesn't exist
    const configSource = path.join(this.configDir, "fonts.conf");
    // const configDest = path.join("/var/task", "fonts.conf");

    if (!fs.existsSync(this.tmpConfigPath)) {
      fs.copyFileSync(configSource, this.tmpConfigPath);
    }

    return this.verifyFonts();
  }

  verifyFonts() {
    try {
      const fonts = fs
        .readdirSync(this.fontsDir)
        .filter((file) => file.toLowerCase().endsWith(".ttf"));

      console.log("Available fonts:", fonts);
      return fonts.length > 0;
    } catch (error) {
      console.error("Error verifying fonts:", error);
      return false;
    }
  }

  getFontPath(fontFamily) {
    const fontFile = fs
      .readdirSync(this.fontsDir)
      .find(
        (file) =>
          file.toLowerCase().startsWith(fontFamily.toLowerCase()) &&
          file.toLowerCase().endsWith(".ttf")
      );

    return fontFile ? path.join(this.fontsDir, fontFile) : null;
  }
}

module.exports = FontConfigGenerator;
