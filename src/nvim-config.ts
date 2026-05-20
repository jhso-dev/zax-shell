import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ZAX_HOME } from './util/paths.js';

export const NVIM_CONFIG_DIR = join(ZAX_HOME, 'config', 'nvim');
export const NVIM_INIT_FILE = join(NVIM_CONFIG_DIR, 'init.lua');

/**
 * Minimal nvim config used ONLY by zax-shell file edits (loaded via `nvim -u`).
 * Does not touch the user's global nvim config. First load auto-installs
 * markview.nvim through lazy.nvim.
 */
const INIT_LUA = `-- zax-shell minimal nvim config: pretty markdown rendering + sane defaults.
-- Loaded only via \`nvim -u <this file>\` when zax-shell opens a doc for editing.

-- lazy.nvim bootstrap (one-time clone)
local data = vim.fn.stdpath("data") .. "/zax-shell"
local lazypath = data .. "/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git", "clone", "--filter=blob:none", "--branch=stable",
    "https://github.com/folke/lazy.nvim.git", lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

vim.g.mapleader = " "
vim.g.maplocalleader = " "

require("lazy").setup({
  -- The headline feature: glow-style in-buffer markdown rendering.
  -- markview falls back to regex highlighting when treesitter isn't present.
  {
    "OXY2DEV/markview.nvim",
    ft = { "markdown" },
    opts = {
      modes = { "n", "no", "c" },
      hybrid_modes = { "i" },
      preview = {
        callbacks = {
          on_enable = function(_, win)
            vim.wo[win].conceallevel = 2
            vim.wo[win].concealcursor = "nc"
          end,
        },
      },
    },
  },
}, {
  root = data .. "/plugins",
  lockfile = data .. "/lazy-lock.json",
  install = { missing = true },
  checker = { enabled = false },
})

-- Comfort settings
vim.opt.number = true
vim.opt.relativenumber = false
vim.opt.wrap = true
vim.opt.linebreak = true
vim.opt.cursorline = true
vim.opt.termguicolors = true
vim.opt.scrolloff = 4
vim.opt.sidescrolloff = 6
vim.opt.signcolumn = "no"
vim.opt.list = false
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.expandtab = true

-- Easier exit (close the file → tmux window closes → cockpit auto-focus)
vim.keymap.set("n", "<leader>q", ":q<CR>",   { silent = true })
vim.keymap.set("n", "<leader>w", ":w<CR>",   { silent = true })
vim.keymap.set("n", "<leader>x", ":wq<CR>",  { silent = true })
`;

/** Write (or overwrite) the bundled nvim config. */
export function ensureNvimConfig(): boolean {
  try {
    if (!existsSync(NVIM_CONFIG_DIR)) mkdirSync(NVIM_CONFIG_DIR, { recursive: true });
    writeFileSync(NVIM_INIT_FILE, INIT_LUA, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Trigger lazy.nvim to install plugins headlessly. Should be called once
 * during the initial install flow; first plugin-fetch can take 30-60s.
 */
export function bootstrapNvimPlugins(): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('nvim', [
      '--headless',
      '-u', NVIM_INIT_FILE,
      '+Lazy! sync',
      '+qa',
    ], { stdio: 'inherit' });
    const t = setTimeout(() => child.kill(), 180_000);
    child.on('exit', () => { clearTimeout(t); resolve(); });
    child.on('error', () => { clearTimeout(t); resolve(); });
  });
}
