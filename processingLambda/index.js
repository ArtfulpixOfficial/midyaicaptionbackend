require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const axios = require("axios");
const FontConfigGenerator = require("./utils/FontConfigGenerator");

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Initialize font configuration
const fontConfig = new FontConfigGenerator();
ffmpeg.setFfmpegPath("/opt/bin/ffmpeg");

let fontsInitialized = false;

const initializeFonts = () => {
  if (!fontsInitialized) {
    fontsInitialized = fontConfig.initialize();
    if (!fontsInitialized) {
      console.error("Failed to initialize fonts");
    }
  }
  return fontsInitialized;
};

// Keep your existing processVideo function
// ... (copy your existing processVideo function here)
async function processVideo(jobId, videoUrl, assUrl) {
  if (!initializeFonts()) {
    throw new Error("Font initialization failed");
  }

  const tempFiles = [];
  try {
    // Download video from Supabase
    console.log("downloading input video from supabase");
    const videoStream = await axios({
      url: videoUrl,
      method: "GET",
      responseType: "stream",
      timeout: 30000,
    });

    console.log("downloading input captions from supabase");
    const assStream = await axios({
      url: assUrl,
      method: "GET",
      responseType: "stream",
      timeout: 30000,
    });

    // Use /tmp directory for Lambda
    const videoPath = "/tmp/temp_video.mp4";
    const subtitlePath = "/tmp/temp_subtitle.ass";
    const outputVideoPath = "/tmp/output_video.mp4";

    tempFiles.push(videoPath, subtitlePath, outputVideoPath);

    // Save video file
    console.log("Saving video file");
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(videoPath);
      videoStream.data.pipe(writeStream);
      writeStream.on("finish", resolve);
      writeStream.on("error", (error) => {
        console.error("Error saving video:", error);
        reject(error);
      });
    });

    // Save subtitle file
    console.log("Saving subtitle file");
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(subtitlePath);
      assStream.data.pipe(writeStream);
      writeStream.on("finish", resolve);
      writeStream.on("error", (error) => {
        console.error("Error saving subtitles:", error);
        reject(error);
      });
    });

    // Verify files
    const videoStats = fs.statSync(videoPath);
    const subtitleStats = fs.statSync(subtitlePath);

    if (videoStats.size === 0)
      throw new Error("Downloaded video file is empty");
    if (subtitleStats.size === 0)
      throw new Error("Downloaded subtitle file is empty");

    console.log(
      "Files saved successfully. Video size:",
      videoStats.size,
      "Subtitle size:",
      subtitleStats.size
    );

    // Escape subtitle path
    const escapedSubtitlePath = subtitlePath
      .replace(/[\\]/g, "\\\\")
      .replace(/[']/g, "\\'");

    // Process video with FFmpeg
    console.log("Starting FFmpeg processing");
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions(
          "-vf",
          `ass='${escapedSubtitlePath}':fontsdir=/var/task/fonts`
        )
        .outputOptions("-preset", "medium")
        .outputOptions("-c:a", "copy")
        .outputOptions("-loglevel", "debug")
        .outputOptions("-y")
        .on("start", (commandLine) => {
          console.log("FFmpeg command:", commandLine);
        })
        .on("codecData", (data) => {
          console.log("codec data:", data);
        })
        .on("progress", async (progress) => {
          console.log(progress);
          // Old Code
          const percent = progress.percent ? Math.round(progress.percent) : 0;

          // New Code
          // const timeArray = progress.timemark.split(':');
          // const seconds = (+timeArray[0]) * 3600 + (+timeArray[1]) * 60 + (+timeArray[2].split('.')[0]);

          // Get total duration in seconds (you need to get this from the input video)
          //           const totalDuration = await new Promise((resolve, reject) => {
          //             ffmpeg.ffprobe(videoPath, (err, metadata) => {
          //               if (err) reject(err);
          //               resolve(metadata.format.duration);
          //            });
          //   }

          // );

          //   // Calculate percentage
          //   const percent = Math.round((seconds / totalDuration) * 100);
          console.log("Processing:", `${percent}%`);
          await updateJobProgress(jobId, percent);
        })
        .on("error", (err) => {
          console.error("FFmpeg error:", err);
          reject(new Error(`FFmpeg processing failed: ${err.message}`));
        })
        .on("end", () => {
          console.log("FFmpeg processing finished");
          resolve();
        })
        .save(outputVideoPath);
    });

    // Verify output
    const outputStats = fs.statSync(outputVideoPath);
    if (outputStats.size === 0)
      throw new Error("Generated output video is empty");

    console.log("Output video generated successfully. Size:", outputStats.size);

    const outputFileName = `output_${Date.now()}`;

    // Upload to Supabase
    console.log("Uploading Final Video to supabase");
    const { error: uploadError } = await supabase.storage
      .from("Caption input and output video bucket")
      .upload(
        `processed/${outputFileName}.mp4`,
        fs.createReadStream(outputVideoPath),
        {
          contentType: "video/mp4",
          duplex: "half",
        }
      );

    if (uploadError) {
      throw new Error(`Supabase upload failed: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage
      .from("Caption input and output video bucket")
      .getPublicUrl(`processed/${outputFileName}.mp4`);

    return urlData.publicUrl;
  } finally {
    // Cleanup temp files
    for (const file of tempFiles) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          console.log(`Cleaned up temporary file: ${file}`);
        }
      } catch (err) {
        console.error(`Error cleaning up ${file}:`, err);
      }
    }
  }
}

async function updateJobStatus(
  jobId,
  status,
  resultUrl = null,
  errorMessage = null
) {
  const updateData = {
    status,
    completed_at: new Date().toISOString(),
  };

  if (resultUrl) updateData.result_url = resultUrl;
  if (errorMessage) updateData.error_message = errorMessage;

  const { error } = await supabase
    .from("video_processing_jobs")
    .update(updateData)
    .eq("job_id", jobId);

  if (error) throw error;
}

async function updateJobProgress(jobId, progress) {
  const { error } = await supabase
    .from("video_processing_jobs")
    .update({ progress })
    .eq("job_id", jobId);

  if (error) console.error("Error updating progress:", error);
}

exports.handler = async (event) => {
  // Handle error case
  console.log(event);
  if (event.errorType === "processing_failed") {
    await updateJobStatus(event.jobId, "failed", null, event.error.message);
    return;
  }

  const { jobId, videoUrl, assUrl } = event;

  try {
    const resultUrl = await processVideo(jobId, videoUrl, assUrl);
    await updateJobStatus(jobId, "completed", resultUrl);
    return { jobId, resultUrl };
  } catch (error) {
    console.error(`Error processing job ${jobId}:`, error);
    await updateJobStatus(jobId, "failed", null, error.message);
    throw error; // Step Functions will handle retry logic
  }
};
