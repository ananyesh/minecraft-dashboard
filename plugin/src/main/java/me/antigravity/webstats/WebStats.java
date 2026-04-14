package me.antigravity.webstats;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Statistic;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.logging.Level;

public class WebStats extends JavaPlugin implements Listener {

    private String databaseURL; // Base Firebase URL (without /stats.json)
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        loadConfig();

        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("WebStats enabled! Persistent cloud storage is active.");

        // Periodically sync all online players
        new BukkitRunnable() {
            @Override
            public void run() {
                for (Player player : Bukkit.getOnlinePlayers()) {
                    syncPlayer(player, true);
                }
            }
        }.runTaskTimerAsynchronously(this, 100L, 200L);
    }

    private void loadConfig() {
        String fullUrl = getConfig().getString("firebase-url", "");
        // Strip /stats.json if present to get the base path
        databaseURL = fullUrl.replace("/stats.json", "").replaceAll("/$", "");
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        syncPlayer(event.getPlayer(), true);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        syncPlayer(event.getPlayer(), false);
    }

    private void syncPlayer(Player player, boolean online) {
        if (databaseURL.isEmpty() || databaseURL.contains("your-project")) return;

        String uuid = player.getUniqueId().toString();
        String playerPath = databaseURL + "/players/" + uuid + ".json";

        StringBuilder json = new StringBuilder("{");
        json.append("\"username\":\"").append(player.getName()).append("\",")
            .append("\"uuid\":\"").append(uuid).append("\",")
            .append("\"online\":").append(online).append(",")
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

        json.append("}") // end stats
            .append("}"); // end root

        // Use PATCH to update only this player's specific entry
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(playerPath))
                .header("Content-Type", "application/json")
                .method("PATCH", HttpRequest.BodyPublishers.ofString(json.toString()))
                .build();

        httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenAccept(response -> {
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        getLogger().warning("Failed to sync player " + player.getName() + ": " + response.statusCode());
                    }
                })
                .exceptionally(ex -> {
                    getLogger().log(Level.WARNING, "Error syncing player: " + ex.getMessage());
                    return null;
                });
    }
}
