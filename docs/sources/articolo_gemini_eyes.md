i'm going to show you how to wire a second pair of eyes into your smartest model, so it can finally watch videos and look at hundreds of images without eating your usage
everyone's working around the same blindness right now, pasting screenshots to claude, hand-transcribing what happens in a video, or pasting frames
most people use either claude code or codex as their main harness
so basically they are stuck with whatever configuration they come by fault
i used OMO (Oh My OpenAgent) through OpenCode since December and because of this I got to use different models for different agents
i quickly learned that it's better to have models for different tasks because not all models are good at everything
back then you couldn't just customize closed source harnesses like claude code or codex, but today that's pretty easy to do
as the models have gotten more intelligent, i went back to using frontier harness like claude code and codex
but I still have my harness set up to run agents with different models
because the truth is that some models are far better at certain tasks
i like fable a lot, but one of the problems is that it can't watch a video
well today I am going to show a very simple way to give it the ability to watch videos
specifically you are going to walk away with all of this:
why your best reasoning model should almost never do its own looking
the cheapest working eyes on the market right now
the exact math per image and per minute of video, so you can budget it before you build
the one-tool setup that lets claude call the eyes itself
let's get crackin'
your reasoner is blind, and that's fine
let me show you what the blindness actually costs
fable 5 and opus 5 cannot watch video, at all, there is no video input on the claude API, no matter what you pay
they can see images, but look at the price of looking... a full-resolution image on opus 5 runs up to 4,784 tokens, at $5 per million input that's about 2 cents per image, on fable at $10 per million it's closer to 5
2 cents sounds small until you remember two things
first, agents look at a LOT of frames, one browsing session or one video breakdown is dozens of screenshots
second, and this is the part nobody prices in, every image sits in the conversation history and gets re-sent on every following turn, so a 20-turn session with 10 images is not 10 image charges, it's closer to 200
the fix is not a smarter multimodal model, the fix is division of labor... your expensive model does the reasoning, a dirt-cheap model does the looking and hands back text
text is what claude wanted anyway, a 300-token description carries the signal of a 4,784-token image at 6% of the weight, on every single turn that follows
so let's give this bad boy some cheap glasses
the eyes: gemini 2.5 flash-lite (i get it from OpenRouter)
flash-lite is google's fast little multimodal model, and on openrouter it costs $0.10 per million input tokens and $0.40 per million output, with a 1 million token context window
it reads images, and unlike claude it reads video, mp4, mov, webm, even a public youtube link
here's the math that made me sit up:
gemini samples video at 1 frame per second, roughly 300 tokens per second of footage at default resolution
a 60-second tiktok ≈ 18,000 tokens ≈ a fifth of a cent
a 3-minute video ≈ half a cent
a full HOUR of youtube video at low resolution ≈ 4 cents
and a single image is 258 tokens, call it three thousandths of a cent, roughly 1,000x cheaper than showing the same image to opus
and yes, flash-lite is not a smart model, but it doesn't have to be, it's a witness not a judge, it describes what's on screen and claude does the judging
the wiring is one tool

openrouter speaks the standard chat completions format, so the whole integration is one curl:
htmlbars
curl https://openrouter.ai/api/v1/chat/completions \
-H "Authorization: Bearer $OPENROUTER_API_KEY" \
-d '{
"model": "google/gemini-2.5-flash-lite",
"messages": [{
"role": "user",
"content": [
{"type": "text", "text": "describe this video shot by shot: timestamps, on-screen text, cuts, and what happens in the first 3 seconds"},
{"type": "video_url", "video_url": {"url": "data:video/mp4;base64,..."}}
]
}]
}'
wrap that in a small script, tell claude "when you need to see an image or a video, call look.sh with the file path and a question", and you're done
now the loop is clean, claude hits something visual, calls the tool, flash-lite watches it, text comes back, claude reasons over text
the prompt you send the eyes matters more than the model, ask for timestamps, on-screen text, cuts, framing, hook structure, not "describe this video"... the tighter the question the more useful the witness
personally this is the only way my business functions, i analyze tiktok videos at scale, and there is no version of that math that works if the watching happens on a frontier model, the eyes have to be cheap or the pipeline doesn't exist
one honest caveat, flash-lite will miss subtle things a frontier model would catch, so when a single frame genuinely decides something important, send that one frame to claude and pay the 2 cents
everything else goes through the cheap eyes
your model doesn't need to see, it needs someone who saw