package me.antigravity.webstats;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Statistic;
import org.bukkit.entity.EntityType;
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

        getLogger().info("WebStats enabled! Dynamic tracking is active.");

        // Start the cloud sync task (runs Every 10 seconds)
        new BukkitRunnable() {
            @Override
            public void run() {
                syncToCloud();
            }
        }.runTaskTimerAsynchronously(this, 100L, 200L);
    }

    private void loadConfig() {
        firebaseURL = getConfig().getString("firebase-url", "https://minecraftstats-5f79c-default-rtdb.asia-southeast1.firebasedatabase.app/stats.json");
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
                    .append("},");

            // Dynamic Mined Blocks
            json.append("\"minecraft:mined\":{");
            boolean firstMined = true;
            for (Material mat : Material.values()) {
                if (mat.isBlock()) {
                    int val = player.getStatistic(Statistic.MINE_BLOCK, mat);
                    if (val > 0) {
                        if (!firstMined) json.append(",");
                        json.append("\"").append(mat.name()).append("\":").append(val);
                        firstMined = false;
                    }
                }
            }
            json.append("},");

            // Dynamic Mob Kills
            json.append("\"minecraft:killed\":{");
            boolean firstKilled = true;
            for (EntityType type : EntityType.values()) {
                if (type.isAlive()) {
                    try {
                        int val = player.getStatistic(Statistic.KILL_ENTITY, type);
                        if (val > 0) {
                            if (!firstKilled) json.append(",");
                            json.append("\"").append(type.name()).append("\":").append(val);
                            firstKilled = false;
                        }
                    } catch (IllegalArgumentException ignored) {} 
                }
            }
            json.append("}");

            json.append("}")
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
