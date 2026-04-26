---
title: Sleep Sound Classification Using ANC-Enabled Earbuds
author: Ken
date: 2022-03-03 00:00:00 +0800
categories: [Research]
tags: [audio, machine learning, classification, health]
math: true
mermaid: true
image:
  path: /assets/img/Sleep_Sounds.PNG
  width: 500
  height: 300
  alt: 
description: An ultra light-weight human sleep sound classification method 
venue: PERCOM::HCCS
paper:  "https://ieeexplore.ieee.org/document/9767394"
display: True

---

# Abstract:

Standard sleep quality assessment methods require custom hardware and professional observation, limiting the diagnosis of sleep disorders to specialized sleep clinics. In this work, we leverage the internal and external microphones present in active noise-cancelling earbuds to distinguish sounds associated with poor or disordered sleep, thereby enabling at-home continuous sleep sound monitoring. The sleep sounds our system is able to recognize include, but are not limited to, snoring, teeth grinding, and restless movement. We analyze the resulting dual-channel audio using a lightweight deep learning model built around a variation of the temporal shift module that has been optimized for audio. The model was designed to have a low memory and computational footprint, making it suitable to be run on a smartphone or the earbuds themselves. We evaluate our approach on a dataset of 8 sound categories generated from 20 participants. We achieve a classification accuracy of 91% and an F1-score of .845
