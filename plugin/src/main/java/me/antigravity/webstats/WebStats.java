package me.antigravity.webstats;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Statistic;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.logging.Level;

public class WebStats extends JavaPlugin {

    private String firebaseURL;
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        loadConfig();

        getLogger().info("WebStats enabled! Syncing to Firebase Cloud.");

        // Start the cloud sync task (runs Every 10 seconds)
        new BukkitRunnable() {
            @Override
            public void run() {
                syncToCloud();
            }
        }.runTaskTimerAsynchronously(this, 100L, 200L);
    }

    private void loadConfig() {
        firebaseURL = getConfig().getString("firebase-url", "https://your-project.firebaseio.com/stats.json");
    }

    private void syncToCloud() {
        if (firebaseURL.contains("your-project")) {
            getLogger().warning("Firebase URL is not configured in config.yml!");
            return;
        }

        StringBuilder json = new StringBuilder("[");
        boolean firstPlayer = true;

        for (Player player : Bukkit.getOnlinePlayers()) {
            if (!firstPlayer) json.append(",");
            firstPlayer = false;

            json.append("{")
                .append("\"username\":\"").append(player.getName()).append("\",")
                .append("\"uuid\":\"").append(player.getUniqueId().toString()).append("\",")
                .append("\"online\":true,")
                .append("\"stats\":{")
                    .append("\"minecraft:custom\":{")
                        .append("\"minecraft:play_one_minute\":").append(player.getStatistic(Statistic.PLAY_ONE_MINUTE)).append(",")
                        .append("\"minecraft:deaths\":").append(player.getStatistic(Statistic.DEATHS)).append(",")
                        .append("\"minecraft:player_kills\":").append(player.getStatistic(Statistic.PLAYER_KILLS)).append(",")
                        .append("\"minecraft:mob_kills\":").append(player.getStatistic(Statistic.MOB_KILLS))
                    .append("},")
                    .append("\"minecraft:mined\":{")
                        .append("\"minecraft:stone\":").append(player.getStatistic(Statistic.MINE_BLOCK, Material.STONE)).append(",")
                        .append("\"minecraft:diamond_ore\":").append(player.getStatistic(Statistic.MINE_BLOCK, Material.DIAMOND_ORE)).append(",")
                        .append("\"minecraft:deepslate_diamond_ore\":").append(player.getStatistic(Statistic.MINE_BLOCK, Material.DEEPSLATE_DIAMOND_ORE))
                    .append("}")
                .append("}")
                .append("}");
        }
        json.append("]");

        // Firebase REST API uses PUT to overwrite the data
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(firebaseURL))
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(json.toString()))
                .build();

        httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenAccept(response -> {
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        getLogger().warning("Firebase sync failed! Status: " + response.statusCode() + " - " + response.body());
                    }
                })
                .exceptionally(ex -> {
                    getLogger().log(Level.WARNING, "Error connecting to Firebase: " + ex.getMessage());
                    return null;
                });
    }
}
