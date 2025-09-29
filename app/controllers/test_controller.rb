# frozen_string_literal: true

# Controller containing actions for endpoints that are used by Pingdom and alike to check that
# certain functionality is working and alive.
class TestController < ApplicationController
  before_action :only_in_test

  # Public: Action that tests that outgoing traffic is possible.
  # Tests outgoing traffic by attempting to read an object from S3.
  def outgoing_traffic
    temp_file = Tempfile.new
    Aws::S3::Resource.new.bucket("gumroad").object("outgoing-traffic-healthcheck.txt").get(response_target: temp_file)
    temp_file.rewind
    render plain: temp_file.read
  end

  # Public: Action that renders a test page with VideoStreamPlayer component
  # for Playwright e2e testing
  def video_player_test
    use_secure_headers_override(:jwplayer_test)
    @video_url = "https://multiplatform-f.akamaihd.net/i/multi/will/bunny/big_buck_bunny_,640x360_400,640x360_700,640x360_1000,950x540_1500,.f4v.csmil/master.m3u8"
    @poster_url = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg"
    render layout: false
  end

  def test_video_player_js
    render plain: <<~JS, content_type: 'application/javascript'
      console.log('External JS executing, checking jwplayer availability...');
      console.log('jwplayer function:', typeof jwplayer);

      // Initialize JW Player
      const player = jwplayer("gumroad-player").setup({
        playlist: [{
          file: "https://multiplatform-f.akamaihd.net/i/multi/will/bunny/big_buck_bunny_,640x360_400,640x360_700,640x360_1000,950x540_1500,.f4v.csmil/master.m3u8",
          image: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg"
        }],
        width: 640,
        height: 360,
        autostart: false
      });

      // Expose player globally for test access
      window.jwplayer = function(selector) {
        if (selector === 'gumroad-player') {
          return player;
        }
        return jwplayer(selector);
      };

      // Set up ready event to signal when player is ready
      player.on('ready', function() {
        console.log('JW Player is ready');
        const playerElement = document.getElementById('gumroad-player');
        if (playerElement) {
          playerElement.setAttribute('data-testid', 'jwplayer-ready');
        }
      });

      // Debug: check what we have after setup
      console.log('After setup - player:', typeof player);
      console.log('After setup - window.jwplayer:', typeof window.jwplayer);
      console.log('After setup - jwplayer function:', typeof jwplayer);
    JS
  end

  private

  def only_in_test
    head :not_found unless Rails.env.test?
  end
end
