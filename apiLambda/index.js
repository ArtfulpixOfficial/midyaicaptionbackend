require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const AWS = require("aws-sdk");

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const stepfunctions = new AWS.StepFunctions();

async function createJob(videoUrl, assUrl) {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const { error } = await supabase.from("video_processing_jobs").insert([
    {
      job_id: jobId,
      status: "processing",
      video_url: videoUrl,
      ass_url: assUrl,
      progress: 0,
      created_at: new Date().toISOString(),
    },
  ]);

  if (error) throw error;
  return jobId;
}

async function getJobStatus(jobId) {
  const { data, error } = await supabase
    .from("video_processing_jobs")
    .select("*")
    .eq("job_id", jobId)
    .single();

  if (error) throw error;
  return data;
}

exports.handler = async (event) => {
  try {
    console.log(event);
    // Handle GET status request
    if (event.requestContext.http.method === "GET" && event.pathParameters?.jobId) {
      const status = await getJobStatus(event.pathParameters.jobId);
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: JSON.stringify(status),
      };
    }

    // Handle POST convert request
    if (event.requestContext.http.method === "POST") {
      const { videoUrl, assUrl } = JSON.parse(event.body);

      if (!videoUrl || !assUrl) {
        return {
          statusCode: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
          },
          body: JSON.stringify({
            error: "Missing videoUrl or assUrl in request body",
          }),
        };
      }

      // Create job record
      const jobId = await createJob(videoUrl, assUrl);

      // Start Step Function execution
      await stepfunctions
        .startExecution({
          stateMachineArn: process.env.STATE_MACHINE_ARN,
          input: JSON.stringify({
            jobId,
            videoUrl,
            assUrl,
          }),
        })
        .promise();

      return {
        statusCode: 202,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: JSON.stringify({
          jobId,
          message: "Video processing started",
          statusUrl: `/api/status/${jobId}`,
        }),
      };
    }
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({
        error: "Internal server error",
        details: error.message,
      }),
    };
  }
};
