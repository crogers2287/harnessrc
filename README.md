# Relay — agent installation entry point

**Start with [docs/AGENT_INSTALL.md](docs/AGENT_INSTALL.md).** It tells a Codex or Claude Code agent how to install Relay, CFRproxy, Herdr and Hermes Telegram on your own server, with Tailscale on all devices and valid HTTPS/custom-domain TLS.

The implementation currently lives on **`feat/universal-agent-remote`**, tracked by [PR #1](https://github.com/crogers2287/harnessrc/pull/1). This default branch holds the setup entry point and reference documentation; clone the implementation branch to build/run the software.

```bash
git clone --branch feat/universal-agent-remote https://github.com/crogers2287/harnessrc.git "$HOME/harnessrc"
```

Give your installation agent the guide above. It must discover your actual hostname, Unix account, private Herdr socket, workspaces, Tailscale DNS name and provider models. A machine named Fred is not required. All agent processes must start in Herdr panes; CFRproxy must appear in every Hermes Telegram profile's model selector. The guide includes verification, safe adaptation, configuration generation, and installation issue reporting.

CFRproxy source is [crogers2287/cfrproxy](https://github.com/crogers2287/cfrproxy), a private repository requiring an accepted invitation. Use your own inference-provider and Telegram credentials. Repository access does not grant the original operator's servers, tailnet or API accounts.

[Report an installation problem](https://github.com/crogers2287/harnessrc/issues/new?template=installation.yml). Review reports for secrets before submitting them. Issues are asynchronous maintainer support; this repository has no unattended privileged installation/fix bot.
